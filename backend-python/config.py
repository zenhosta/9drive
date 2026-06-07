from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    APP_PORT: int = 4000
    FRONTEND_URL: str = "http://localhost:5173"
    JWT_ACCESS_SECRET: str
    TOKEN_ENCRYPTION_KEY: str  # harus 32 bytes
    ACCESS_TOKEN_TTL_SECONDS: int = 900
    REFRESH_TOKEN_TTL_DAYS: int = 30
    MAX_UPLOAD_BYTES: int = 5368709120
    RECAPTCHA_SECRET_KEY: str = ""
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:4000/connected-accounts/google/callback"

    class Config:
        env_file = ".env"

settings = Settings()
