from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models.user import User, ConnectedAccount
from middleware.auth import get_current_user

router = APIRouter()

@router.get("/summary")
def storage_summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    accounts = db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user.id).all()
    total_limit = sum(a.quota_limit for a in accounts)
    total_used = sum(a.quota_used for a in accounts)
    return {
        "totalLimit": total_limit,
        "totalUsed": total_used,
        "totalFree": total_limit - total_used,
        "accounts": [
            {
                "id": a.id,
                "email": a.email,
                "quotaLimit": a.quota_limit,
                "quotaUsed": a.quota_used,
                "freeSpace": a.quota_limit - a.quota_used,
            }
            for a in accounts
        ]
    }
