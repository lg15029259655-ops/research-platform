import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


def local_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else BACKEND_DIR / path


def database_url() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///./data/app.db")
    prefix = "sqlite:///"
    if url.startswith(prefix):
        return prefix + local_path(url[len(prefix):]).resolve().as_posix()
    return url


def upload_dir() -> Path:
    return local_path(os.getenv("UPLOAD_DIR", "./data/uploads")).resolve()


def max_pdf_bytes() -> int:
    return int(os.getenv("MAX_PDF_SIZE_MB", "100")) * 1024 * 1024
