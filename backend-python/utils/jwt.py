from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from config import settings

ALGORITHM = "HS256"

def sign_access_token(sub: str, sid: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=settings.ACCESS_TOKEN_TTL_SECONDS)
    return jwt.encode({"sub": sub, "sid": sid, "exp": expire}, settings.JWT_ACCESS_SECRET, algorithm=ALGORITHM)

def verify_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_ACCESS_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        raise ValueError("Invalid token")
