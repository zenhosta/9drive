from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import get_db
from models.user import User, VirtualFolder
from middleware.auth import get_current_user

router = APIRouter()

class FolderBody(BaseModel):
    name: str
    color: str = "#6366f1"
    icon_url: str | None = None
    parent_id: str | None = None

@router.get("")
def list_folders(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    folders = db.query(VirtualFolder).filter(VirtualFolder.user_id == user.id).all()
    return [
        {
            "id": f.id,
            "name": f.name,
            "color": f.color,
            "iconUrl": f.icon_url,
            "parentId": f.parent_id,
            "createdAt": f.created_at.isoformat(),
        }
        for f in folders
    ]

@router.get("/recent")
def recent_folders(
    limit: int = 4,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    folders = db.query(VirtualFolder).filter(
        VirtualFolder.user_id == user.id
    ).order_by(VirtualFolder.created_at.desc()).limit(limit).all()
    return [{"id": f.id, "name": f.name, "color": f.color} for f in folders]

@router.post("", status_code=201)
def create_folder(body: FolderBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    folder = VirtualFolder(
        user_id=user.id,
        name=body.name,
        color=body.color,
        icon_url=body.icon_url,
        parent_id=body.parent_id,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return {"id": folder.id, "name": folder.name, "color": folder.color, "parentId": folder.parent_id}

@router.patch("/{folder_id}")
def update_folder(folder_id: str, body: FolderBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    folder = db.query(VirtualFolder).filter(
        VirtualFolder.id == folder_id,
        VirtualFolder.user_id == user.id
    ).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    folder.name = body.name
    folder.color = body.color
    folder.icon_url = body.icon_url
    db.commit()
    return {"id": folder.id, "name": folder.name, "color": folder.color}

@router.delete("/{folder_id}")
def delete_folder(folder_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    folder = db.query(VirtualFolder).filter(
        VirtualFolder.id == folder_id,
        VirtualFolder.user_id == user.id
    ).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    db.delete(folder)
    db.commit()
    return {"ok": True}