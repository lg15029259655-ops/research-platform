import hashlib
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config import max_pdf_bytes, upload_dir


def _write_pdf(source, original_name: str, user_id: str, paper_id: str) -> tuple[str, str, int, str]:
    folder = upload_dir() / user_id / paper_id
    folder.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid4()}.pdf"
    target = folder / stored_name
    digest = hashlib.sha256()
    size = 0
    try:
        with target.open("wb") as out:
            first = source.read(5)
            if first != b"%PDF-":
                raise HTTPException(400, "文件内容不是有效的 PDF")
            out.write(first)
            digest.update(first)
            size = len(first)
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                if size > max_pdf_bytes():
                    raise HTTPException(413, "PDF 超过上传大小限制")
                out.write(chunk)
                digest.update(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return original_name, str(target), size, digest.hexdigest()


async def save_pdf(file: UploadFile, user_id: str, paper_id: str) -> tuple[str, str, int, str]:
    original_name = Path(file.filename or "").name
    try:
        if not original_name.lower().endswith(".pdf") or file.content_type not in {"application/pdf", "application/x-pdf"}:
            raise HTTPException(400, "只支持 PDF 文件")
        # Disk writes and SHA256 over large uploads can otherwise stall every
        # async request on the event loop, even when UploadFile.read is async.
        return await run_in_threadpool(_write_pdf, file.file, original_name, user_id, paper_id)
    finally:
        await file.close()
