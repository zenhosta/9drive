from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from database import get_db
from models.user import User, ConnectedAccount, DriveFile
from middleware.auth import get_current_user
from utils.crypto import decrypt_text
from config import settings
import io
from pydantic import BaseModel

router = APIRouter()

DRIVE_ROOT_FOLDER = "9drive"

def get_creds(account: ConnectedAccount) -> Credentials:
    creds = Credentials(
        token=decrypt_text(account.access_token_encrypted),
        refresh_token=decrypt_text(account.refresh_token_encrypted) if account.refresh_token_encrypted else None,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
    )
    # auto refresh kalau expired
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        account.access_token_encrypted = __import__('utils.crypto', fromlist=['encrypt_text']).encrypt_text(creds.token)
    return creds

def get_or_create_root_folder(service) -> str:
    # cari folder 9drive di root Drive
    query = f"name='{DRIVE_ROOT_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    results = service.files().list(q=query, fields="files(id, name)").execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]
    # buat kalau belum ada
    folder = service.files().create(
        body={"name": DRIVE_ROOT_FOLDER, "mimeType": "application/vnd.google-apps.folder"},
        fields="id"
    ).execute()
    return folder["id"]

def pick_account(accounts: list[ConnectedAccount], file_size: int) -> ConnectedAccount | None:
    # pilih akun yang punya ruang cukup, sorted by free space terbanyak
    eligible = [a for a in accounts if (a.quota_limit - a.quota_used) >= file_size]
    if not eligible:
        return None
    return sorted(eligible, key=lambda a: a.quota_limit - a.quota_used, reverse=True)[0]

def update_quota(service, account: ConnectedAccount):
    about = service.about().get(fields="storageQuota").execute()
    quota = about.get("storageQuota", {})
    account.quota_limit = int(quota.get("limit", 0))
    account.quota_used = int(quota.get("usage", 0))

# --- Upload ---

@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    fileName: str = Form(None),
    sizeBytes: int = Form(...),
    mimeType: str = Form(None),
    folderId: str = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    accounts = db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user.id).all()
    if not accounts:
        raise HTTPException(status_code=400, detail="No connected Drive accounts")

    target = pick_account(accounts, sizeBytes)
    if not target:
        raise HTTPException(status_code=400, detail="No Drive account has enough space")

    creds = get_creds(target)
    service = build("drive", "v3", credentials=creds)

    root_folder_id = get_or_create_root_folder(service)

    name = fileName or file.filename or "untitled"
    mime = mimeType or file.content_type or "application/octet-stream"

    content = await file.read()
    media = MediaIoBaseUpload(io.BytesIO(content), mimetype=mime, resumable=False)

    drive_file = service.files().create(
        body={"name": name, "parents": [root_folder_id]},
        media_body=media,
        fields="id, name, mimeType, size"
    ).execute()

    update_quota(service, target)

    db_file = DriveFile(
        user_id=user.id,
        connected_account_id=target.id,
        folder_id=folderId,
        google_drive_file_id=drive_file["id"],
        name=name,
        mime_type=mime,
        size_bytes=sizeBytes,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    return {
        "id": db_file.id,
        "name": db_file.name,
        "mimeType": db_file.mime_type,
        "sizeBytes": db_file.size_bytes,
        "googleDriveFileId": db_file.google_drive_file_id,
        "accountEmail": target.email,
    }

# --- List Files ---

@router.get("")
def list_files(
    folderId: str = None,
    q: str = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(DriveFile).filter(DriveFile.user_id == user.id)
    if folderId:
        query = query.filter(DriveFile.folder_id == folderId)
    if q:
        query = query.filter(DriveFile.name.ilike(f"%{q}%"))
    files = query.order_by(DriveFile.created_at.desc()).all()
    return [
        {
            "id": f.id,
            "name": f.name,
            "mimeType": f.mime_type,
            "sizeBytes": str(f.size_bytes),
            "createdAt": f.created_at.isoformat(),
            "folderId": f.folder_id,
            "connectedAccount": {
                "email": f.connected_account.email,
                "provider": f.connected_account.provider,
            } if f.connected_account else None,
        }
        for f in files
    ]

# --- Batch (HARUS di atas /{file_id} supaya tidak tertimpa route dynamic) ---

class BatchBody(BaseModel):
    ids: list[str]
    folderId: str | None = None
    action: str  # "move" atau "delete"

@router.patch("/batch")
def batch_files(
    body: BatchBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    files = db.query(DriveFile).filter(
        DriveFile.id.in_(body.ids),
        DriveFile.user_id == user.id,
    ).all()

    if body.action == "move":
        for f in files:
            f.folder_id = body.folderId
        db.commit()
        return {"ok": True, "updated": len(files)}

    elif body.action == "delete":
        for f in files:
            account = db.query(ConnectedAccount).filter(ConnectedAccount.id == f.connected_account_id).first()
            if account:
                try:
                    creds = get_creds(account)
                    service = build("drive", "v3", credentials=creds)
                    service.files().delete(fileId=f.google_drive_file_id).execute()
                except Exception:
                    pass
            db.delete(f)
        db.commit()
        return {"ok": True, "deleted": len(files)}

    raise HTTPException(status_code=400, detail="Invalid action, use 'move' or 'delete'")

# --- Sync Google (HARUS di atas /{file_id} — static path duluan) ---

@router.post("/sync-google")
def sync_google(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    accounts = db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user.id).all()
    synced = 0

    for account in accounts:
        try:
            creds = get_creds(account)
            service = build("drive", "v3", credentials=creds)

            # cari folder 9drive
            query = "name='9drive' and mimeType='application/vnd.google-apps.folder' and trashed=false"
            results = service.files().list(q=query, fields="files(id)").execute()
            folders = results.get("files", [])
            if not folders:
                continue

            root_id = folders[0]["id"]

            # list semua file di folder 9drive
            query = f"'{root_id}' in parents and trashed=false"
            page_token = None
            while True:
                resp = service.files().list(
                    q=query,
                    fields="nextPageToken, files(id, name, mimeType, size)",
                    pageToken=page_token
                ).execute()

                for drive_file in resp.get("files", []):
                    existing = db.query(DriveFile).filter(
                        DriveFile.google_drive_file_id == drive_file["id"],
                        DriveFile.user_id == user.id,
                    ).first()
                    if not existing:
                        db.add(DriveFile(
                            user_id=user.id,
                            connected_account_id=account.id,
                            google_drive_file_id=drive_file["id"],
                            name=drive_file["name"],
                            mime_type=drive_file.get("mimeType", "application/octet-stream"),
                            size_bytes=int(drive_file.get("size", 0)),
                        ))
                        synced += 1

                page_token = resp.get("nextPageToken")
                if not page_token:
                    break

            db.commit()
            update_quota(service, account)
            db.commit()

        except Exception as e:
            continue

    return {"synced": synced}

# --- Delete (dynamic route — HARUS di bawah semua static routes) ---

@router.delete("/{file_id}")
def delete_file(
    file_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db_file = db.query(DriveFile).filter(
        DriveFile.id == file_id,
        DriveFile.user_id == user.id,
    ).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found")

    account = db.query(ConnectedAccount).filter(ConnectedAccount.id == db_file.connected_account_id).first()
    if account:
        try:
            creds = get_creds(account)
            service = build("drive", "v3", credentials=creds)
            service.files().delete(fileId=db_file.google_drive_file_id).execute()
            update_quota(service, account)
        except Exception:
            pass  # kalau gagal hapus di Drive, tetap hapus dari DB

    db.delete(db_file)
    db.commit()
    return {"ok": True}

# --- Rename ---

@router.patch("/{file_id}")
def rename_file(
    file_id: str,
    body: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db_file = db.query(DriveFile).filter(
        DriveFile.id == file_id,
        DriveFile.user_id == user.id,
    ).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found")

    new_name = body.get("name")
    if new_name:
        account = db.query(ConnectedAccount).filter(ConnectedAccount.id == db_file.connected_account_id).first()
        if account:
            creds = get_creds(account)
            service = build("drive", "v3", credentials=creds)
            service.files().update(fileId=db_file.google_drive_file_id, body={"name": new_name}).execute()
        db_file.name = new_name
        db.commit()

    return {"id": db_file.id, "name": db_file.name}

# --- Download ---

@router.get("/{file_id}/download")
def download_file(
    file_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_file = db.query(DriveFile).filter(
        DriveFile.id == file_id,
        DriveFile.user_id == current_user.id,
    ).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found")

    account = db.query(ConnectedAccount).filter(ConnectedAccount.id == db_file.connected_account_id).first()
    creds = get_creds(account)
    service = build("drive", "v3", credentials=creds)

    request = service.files().get_media(fileId=db_file.google_drive_file_id)
    content = request.execute()

    # kalau image/pdf/video/audio → inline supaya bisa di-preview di browser
    previewable = db_file.mime_type.startswith(("image/", "video/", "audio/")) or "pdf" in db_file.mime_type
    disposition = "inline" if previewable else f'attachment; filename="{db_file.name}"'

    return StreamingResponse(
        io.BytesIO(content),
        media_type=db_file.mime_type,
        headers={"Content-Disposition": disposition},
    )