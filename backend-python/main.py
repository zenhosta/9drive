from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from database import Base, engine
from routers import auth, files, folders, drive, storage

Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth")
app.include_router(drive.router, prefix="/connected-accounts")
app.include_router(files.router, prefix="/files")
app.include_router(folders.router, prefix="/folders")
app.include_router(storage.router, prefix="/storage")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.APP_PORT, reload=True)