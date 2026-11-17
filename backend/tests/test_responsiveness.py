import asyncio
import io
import threading
from types import SimpleNamespace
from uuid import uuid4

from fastapi.responses import JSONResponse
from fastapi import UploadFile
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import auth
from app.db import SessionLocal
from app.main import app
from app.models import Paper, PaperImage, User
from app.services import file_service


def test_upload_disk_write_does_not_block_event_loop(monkeypatch):
    entered = threading.Event()
    release = threading.Event()

    def slow_write(*_args):
        entered.set()
        release.wait(2)
        return "test.pdf", "temporary", 5, "digest"

    monkeypatch.setattr(file_service, "_write_pdf", slow_write)

    async def run():
        upload = UploadFile(file=io.BytesIO(b"%PDF-"), filename="test.pdf",
                            headers={"content-type": "application/pdf"})
        task = asyncio.create_task(file_service.save_pdf(upload, "owner", "paper"))
        try:
            assert await asyncio.to_thread(entered.wait, 1)
            await asyncio.wait_for(asyncio.sleep(0.01), timeout=0.5)
            assert not task.done()
        finally:
            release.set()
            await task

    asyncio.run(run())


def test_session_database_wait_does_not_block_event_loop(monkeypatch):
    entered = threading.Event()
    release = threading.Event()

    def slow_resolve(_token):
        entered.set()
        release.wait(2)
        return "owner", None

    monkeypatch.setattr(auth, "_resolve_owner", slow_resolve)

    async def run():
        request = SimpleNamespace(method="GET", url=SimpleNamespace(path="/api/test", scheme="http"),
                                  headers={}, cookies={}, state=SimpleNamespace())
        async def next_handler(_request):
            return JSONResponse({"ok": True})
        task = asyncio.create_task(auth.anonymous_session(request, next_handler))
        try:
            started = await asyncio.to_thread(entered.wait, 1)
            assert started
            await asyncio.wait_for(asyncio.sleep(0.01), timeout=0.5)
            assert not task.done()
        finally:
            release.set()
            await task
        assert request.state.owner_id == "owner"

    asyncio.run(run())


def test_paper_list_counts_images_and_preserves_owner_isolation():
    with TestClient(app) as first, TestClient(app) as second:
        first.get("/api/papers")
        second.get("/api/papers")
        with SessionLocal() as db:
            owner = db.scalar(select(User).where(User.session_hash == auth.session_hash(first.cookies[auth.COOKIE_NAME])))
            paper_id = str(uuid4())
            db.add(Paper(id=paper_id, owner_id=owner.id, title="Count test", original_filename="test.pdf",
                         stored_filename="test.pdf", local_file_path="test.pdf", mime_type="application/pdf",
                         file_size_bytes=0, sha256="0" * 64, status="metadata_only", domain="biology"))
            db.add_all([PaperImage(id=str(uuid4()), paper_id=paper_id, page_number=1, xref=i,
                                   local_file_path="test.png", width=1, height=1) for i in range(2)])
            db.commit()
        own = first.get("/api/papers").json()
        other = second.get("/api/papers").json()
        assert next(p for p in own if p["id"] == paper_id)["image_count"] == 2
        assert all(p["id"] != paper_id for p in other)


def test_workspace_patch_rejects_foreign_origin(monkeypatch):
    monkeypatch.setenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000")
    with TestClient(app) as client:
        client.get("/api/session")
        response = client.patch("/api/workspace", headers={"Origin": "https://other.example"},
                                json={"design_idea": "unauthorized change"})
        assert response.status_code == 403
        assert client.get("/api/workspace").json().get("design_idea") != "unauthorized change"
