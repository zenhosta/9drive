from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google_auth_oauthlib.flow import Flow
from database import get_db
from models.user import User, ConnectedAccount
from middleware.auth import get_current_user
from utils.crypto import encrypt_text, decrypt_text
from config import settings

router = APIRouter()

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "openid",
]

def make_flow():
    import os
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"  # allow http localhost
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=SCOPES,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )
    return flow

@router.get("/google/connect-url")
def connect_url(user: User = Depends(get_current_user)):
    flow = make_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        state=f"user:{user.id}",
    )
    # hapus code_challenge dari URL
    from urllib.parse import urlparse, urlencode, parse_qs
    parsed = urlparse(auth_url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params.pop("code_challenge", None)
    params.pop("code_challenge_method", None)
    clean_params = {k: v[0] for k, v in params.items()}
    clean_url = parsed._replace(query=urlencode(clean_params)).geturl()
    return {"url": clean_url}

def get_user_info(creds: Credentials):
    service = build("oauth2", "v2", credentials=creds)
    return service.userinfo().get().execute()

def get_drive_quota(creds: Credentials):
    service = build("drive", "v3", credentials=creds)
    about = service.about().get(fields="storageQuota").execute()
    quota = about.get("storageQuota", {})
    return int(quota.get("limit", 0)), int(quota.get("usage", 0))

# --- Connect Drive (untuk user yang sudah login) ---

@router.get("/google/connect-url")
def connect_url(user: User = Depends(get_current_user)):
    flow = make_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=f"user:{user.id}",
    )
    return {"url": auth_url}

@router.get("/google/callback")
def google_callback(code: str, state: str = "", db: Session = Depends(get_db)):
    import os
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    flow = make_flow()
    flow.fetch_token(code=code)
    creds = flow.credentials

    user_info = get_user_info(creds)
    email = user_info.get("email")
    quota_limit, quota_used = get_drive_quota(creds)

    # cek apakah akun ini sudah terkoneksi
    user_id = state.replace("user:", "") if state.startswith("user:") else None
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid state")

    existing = db.query(ConnectedAccount).filter(
        ConnectedAccount.user_id == user_id,
        ConnectedAccount.email == email,
    ).first()

    if existing:
        existing.access_token_encrypted = encrypt_text(creds.token)
        existing.refresh_token_encrypted = encrypt_text(creds.refresh_token) if creds.refresh_token else existing.refresh_token_encrypted
        existing.quota_limit = quota_limit
        existing.quota_used = quota_used
        db.commit()
    else:
        account = ConnectedAccount(
            user_id=user_id,
            provider="google",
            email=email,
            access_token_encrypted=encrypt_text(creds.token),
            refresh_token_encrypted=encrypt_text(creds.refresh_token) if creds.refresh_token else None,
            quota_limit=quota_limit,
            quota_used=quota_used,
        )
        db.add(account)
        db.commit()

    return RedirectResponse(f"{settings.FRONTEND_URL}/settings?connected=1")

@router.get("")
def list_accounts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    accounts = db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user.id).all()
    return [
        {
            "id": a.id,
            "email": a.email,
            "provider": a.provider,
            "quotaLimit": a.quota_limit,
            "quotaUsed": a.quota_used,
            "freeSpace": a.quota_limit - a.quota_used,
        }
        for a in accounts
    ]

@router.post("/{account_id}/sync-quota")
def sync_quota(account_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    account = db.query(ConnectedAccount).filter(
        ConnectedAccount.id == account_id,
        ConnectedAccount.user_id == user.id,
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    creds = Credentials(
        token=decrypt_text(account.access_token_encrypted),
        refresh_token=decrypt_text(account.refresh_token_encrypted) if account.refresh_token_encrypted else None,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
    )
    quota_limit, quota_used = get_drive_quota(creds)
    account.quota_limit = quota_limit
    account.quota_used = quota_used
    db.commit()
    return {"quotaLimit": quota_limit, "quotaUsed": quota_used}

@router.delete("/{account_id}")
def disconnect_account(account_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    account = db.query(ConnectedAccount).filter(
        ConnectedAccount.id == account_id,
        ConnectedAccount.user_id == user.id,
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    db.delete(account)
    db.commit()
    return {"ok": True}