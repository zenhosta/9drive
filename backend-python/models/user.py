import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, Text, JSON, ForeignKey, BigInteger, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base

def gen_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(191))
    email: Mapped[str] = mapped_column(String(191), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    sessions: Mapped[list["UserSession"]] = relationship(back_populates="user")
    connected_accounts: Mapped[list["ConnectedAccount"]] = relationship(back_populates="user")

class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    refresh_token_hash: Mapped[str] = mapped_column(String(255))
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    user: Mapped["User"] = relationship(back_populates="sessions")

class ConnectedAccount(Base):
    __tablename__ = "connected_accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    provider: Mapped[str] = mapped_column(String(32))
    email: Mapped[str] = mapped_column(String(191))
    access_token_encrypted: Mapped[str] = mapped_column(Text)
    refresh_token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    quota_limit: Mapped[int] = mapped_column(BigInteger, default=0)
    quota_used: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user: Mapped["User"] = relationship(back_populates="connected_accounts")
    files: Mapped[list["DriveFile"]] = relationship(back_populates="connected_account")

class VirtualFolder(Base):
    __tablename__ = "virtual_folders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(191))
    color: Mapped[str] = mapped_column(String(32), default="#6366f1")
    icon_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("virtual_folders.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    files: Mapped[list["DriveFile"]] = relationship(back_populates="folder")

class DriveFile(Base):
    __tablename__ = "drive_files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    connected_account_id: Mapped[str] = mapped_column(String(36), ForeignKey("connected_accounts.id"))
    folder_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("virtual_folders.id"), nullable=True)
    google_drive_file_id: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(127))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    connected_account: Mapped["ConnectedAccount"] = relationship(back_populates="files")
    folder: Mapped["VirtualFolder | None"] = relationship(back_populates="files")
