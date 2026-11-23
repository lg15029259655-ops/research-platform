import asyncio
import io
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import uuid4

from fastapi.responses import JSONResponse
from fastapi import UploadFile
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import auth
from app.db import SessionLocal
from app.main import app
from app.models import DemoSeedMarker, Paper, PaperImage, ResearchWorkspace, User
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


def test_seeded_visitor_does_not_wait_for_demo_setup(monkeypatch):
    with TestClient(app) as client:
        client.get("/api/session")
        token = client.cookies[auth.COOKIE_NAME]
        with SessionLocal() as db:
            owner = db.scalar(select(User.id).where(User.session_hash == auth.session_hash(token)))
            db.add(DemoSeedMarker(owner_id=owner))
            db.commit()

        monkeypatch.setenv("DEMO_SEED_DIR", "unused-in-fast-path")
        with ThreadPoolExecutor(max_workers=1) as pool:
            with auth._demo_lock:
                response = pool.submit(client.get, "/api/papers").result(timeout=3)
                assert response.status_code == 200


def test_library_summary_revalidates_by_owner_and_visible_content():
    url = "/api/papers?view=summary"
    with TestClient(app) as first, TestClient(app) as second:
        first.get("/api/session")
        second.get("/api/session")
        with SessionLocal() as db:
            owner_id = db.scalar(select(User.id).where(User.session_hash == auth.session_hash(first.cookies[auth.COOKIE_NAME])))
            paper_id = str(uuid4())
            db.add(Paper(id=paper_id, owner_id=owner_id, title="Library summary", original_filename="source.pdf",
                         stored_filename="test.pdf", local_file_path="test.pdf", mime_type="application/pdf",
                         file_size_bytes=0, sha256="0" * 64, status="uploaded", abstract="Long abstract " * 500,
                         openalex_id="W123", domain="general"))
            db.commit()

        initial = first.get(url)
        assert initial.json() == [{"id": paper_id, "title": "Library summary", "original_filename": "source.pdf",
                                   "status": "uploaded", "warning": None, "openalex_id": "W123", "domain": "general",
                                   "source_matches": True}]
        assert initial.headers["Cache-Control"] == "private, no-cache"
        assert "Cookie" in initial.headers["Vary"]
        conditional = {"If-None-Match": "W/" + initial.headers["ETag"]}
        unchanged = first.get(url, headers=conditional)
        assert unchanged.status_code == 304 and not unchanged.content
        assert second.get(url, headers=conditional).json() == []
        assert first.get("/api/papers").json()[0]["abstract"] == "Long abstract " * 500

        with SessionLocal() as db:
            paper = db.get(Paper, paper_id)
            paper.status = "parsed"
            paper.parse_warning = "Check extracted sections"
            paper.source_sha256 = "1" * 64
            db.commit()

        changed = first.get(url, headers=conditional)
        assert changed.status_code == 200 and changed.headers["ETag"] != initial.headers["ETag"]
        assert changed.json()[0]["status"] == "parsed"
        assert changed.json()[0]["warning"] == "Check extracted sections"
        assert changed.json()[0]["source_matches"] is False
        assert "sha256" not in changed.json()[0] and "source_sha256" not in changed.json()[0]


def test_concurrent_first_workspace_requests_share_one_row(monkeypatch):
    with TestClient(app) as client:
        client.get("/api/session")
        barrier = threading.Barrier(2, timeout=3)
        session_type = SessionLocal.class_
        scalar = session_type.scalar

        def synchronize_first_lookup(db, statement, *args, **kwargs):
            result = scalar(db, statement, *args, **kwargs)
            if result is None and statement.column_descriptions[0]["entity"] is ResearchWorkspace:
                barrier.wait()
            return result

        monkeypatch.setattr(session_type, "scalar", synchronize_first_lookup)
        with ThreadPoolExecutor(max_workers=2) as pool:
            requests = [pool.submit(client.get, "/api/workspace") for _ in range(2)]
            first, second = [pending.result(timeout=5) for pending in requests]

        assert first.status_code == second.status_code == 200
        assert first.json()["workspace_id"] == second.json()["workspace_id"]


def test_workspace_patch_rejects_foreign_origin(monkeypatch):
    monkeypatch.setenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000")
    with TestClient(app) as client:
        client.get("/api/session")
        response = client.patch("/api/workspace", headers={"Origin": "https://other.example"},
                                json={"design_idea": "unauthorized change"})
        assert response.status_code == 403
        assert client.get("/api/workspace").json().get("design_idea") != "unauthorized change"
