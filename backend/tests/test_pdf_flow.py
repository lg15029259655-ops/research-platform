import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pymupdf
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import COOKIE_AGE, COOKIE_NAME, session_hash
from app.db import SessionLocal
from app.main import app
from app.models import Message, Paper, User
from app.services.pdf_service import parse_pdf, render_page_png, extract_unlabeled_abstract


def make_pdf(title: str, *, figure: bool = True, table: bool = False) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    lines = [title, "Abstract", "Cellular injury was studied.", "Introduction",
             "The mechanism remains uncertain.", "Methods", "Treatment and control were compared.",
             "Results", "Treatment changed the measured signal."]
    if figure:
        lines += ["Figure 1. Signal in treatment and control groups."]
    if table:
        lines += ["Table 1. Baseline characteristics of the two groups."]
    lines += ["Discussion", "Other explanations remain.", "Conclusion", "Validation is needed."]
    y = 50
    for line in lines:
        page.insert_text((50, y), line, fontsize=12)
        y += 30
    data = doc.tobytes()
    doc.close()
    return data


def test_unlabeled_abstract_requires_first_page_citation_marker():
    doc = pymupdf.open()
    page = doc.new_page()
    prose = ("This study examined the comparison between treatment and control. " * 12 +
             "The evidence is limited. https://doi.org/10.1234/example")
    assert page.insert_textbox(pymupdf.Rect(45, 310, 555, 570), prose, fontsize=10) >= 0
    assert "This study" in (extract_unlabeled_abstract(page) or "")
    doc.close()


def test_long_review_recovers_unclassified_body_per_page(tmp_path):
    doc = pymupdf.open()
    for index in range(4):
        page = doc.new_page()
        if index == 0:
            page.insert_text((40, 25), "Abstract", fontsize=10)
        for line in range(48):
            page.insert_text((40, 45 + line * 12), f"Page {index + 1} contains review evidence and discussion about the study findings {line}.", fontsize=8)
    path = tmp_path / "review.pdf"
    path.write_bytes(doc.tobytes())
    doc.close()
    parsed = parse_pdf(path)
    body = [unit for unit in parsed.units if unit.kind == "BODY"]
    assert [unit.page_start for unit in body] == [1, 2, 3, 4]
    assert all(unit.page_start == unit.page_end and f"Page {unit.page_start}" in unit.text for unit in body)
    assert not any(unit.kind == "ABSTRACT" and len(unit.text) > 10000 for unit in parsed.units)
    assert "未分类" in parsed.warning


def test_repeated_results_sections_keep_all_evidence(tmp_path):
    doc = pymupdf.open()
    for number in (1, 2):
        page = doc.new_page()
        for index, line in enumerate(("Results", f"Distinct finding number {number}.",
                                      f"Figure {number}. Evidence for finding {number}.")):
            page.insert_text((50, 60 + index * 25), line, fontsize=12)
    path = tmp_path / "multiple-results.pdf"
    path.write_bytes(doc.tobytes())
    doc.close()
    units = parse_pdf(path).units
    results = [item for item in units if item.kind == "RESULTS"]
    assert len(results) == 2
    assert "finding number 1" in results[0].text
    assert "finding number 2" in results[1].text
    assert [item.heading for item in units if item.kind == "FIGURE"] == ["Figure 1", "Figure 2"]


def test_results_chunks_preserve_page_ranges():
    from app.services.pdf_service import ParsedUnit, result_text_units

    pages = {1: ["a" * 3000], 2: ["b" * 3000], 3: ["c" * 3000]}
    section = ParsedUnit("RESULTS", "Results", "".join(line + "\n" for lines in pages.values() for line in lines), 1, 3)
    chunks = result_text_units(section, pages)
    assert [(chunk.page_start, chunk.page_end) for chunk in chunks] == [(1, 2), (2, 3)]
    assert chunks[1].text.startswith("b")


def test_paper_without_standard_headings_keeps_readable_pages(tmp_path):
    doc = pymupdf.open()
    for number in (1, 2):
        page = doc.new_page()
        for index in range(22):
            page.insert_text((40, 40 + index * 18), f"Page {number} reports a measured observation in this study {index}.", fontsize=9)
    page = doc.new_page()
    page.insert_text((40, 40), "References", fontsize=10)
    for index in range(22):
        page.insert_text((40, 60 + index * 18), f"Reference entry that must not be treated as body {index}.", fontsize=9)
    path = tmp_path / "no-standard-headings.pdf"
    path.write_bytes(doc.tobytes())
    doc.close()
    parsed = parse_pdf(path)
    body = [unit for unit in parsed.units if unit.kind == "BODY"]
    assert [unit.page_start for unit in body] == [1, 2]
    assert all("Reference entry" not in unit.text for unit in body)
    assert "未分类" in parsed.warning


def test_long_introduction_fallback_keeps_page_order_before_conclusion(tmp_path):
    doc = pymupdf.open()
    for number in range(1, 5):
        page = doc.new_page()
        if number == 1:
            page.insert_text((40, 25), "Introduction", fontsize=10)
        for index in range(48):
            page.insert_text((40, 45 + index * 12), f"Page {number} reports evidence and observations from this study {index}.", fontsize=8)
    page = doc.new_page()
    page.insert_text((40, 25), "Conclusion", fontsize=10)
    page.insert_text((40, 45), "The conclusion requires further validation.", fontsize=9)
    path = tmp_path / "long-introduction.pdf"
    path.write_bytes(doc.tobytes())
    doc.close()
    units = parse_pdf(path).units
    assert [unit.page_start for unit in units if unit.kind == "BODY"] == [1, 2, 3, 4]
    assert next(i for i, unit in enumerate(units) if unit.kind == "CONCLUSION") > max(i for i, unit in enumerate(units) if unit.kind == "BODY")


def upload(client: TestClient, title: str, **kwargs) -> dict:
    response = client.post("/api/papers", files={"file": ("unrelated-name.pdf", make_pdf(title, **kwargs), "application/pdf")})
    assert response.status_code == 200, response.text
    return response.json()


def owner_of(client: TestClient) -> str:
    with SessionLocal() as db:
        return db.scalar(select(User).where(User.session_hash == session_hash(client.cookies.get(COOKIE_NAME)))).id


def test_progress_poll_is_lightweight_and_owner_scoped(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as owner, TestClient(app) as other:
        users = []
        try:
            paper = upload(owner, "Progress check")
            users.append(owner_of(owner))
            other.get("/api/session")
            users.append(owner_of(other))
            def fail_pdf_open(*_args, **_kwargs):
                raise AssertionError("progress polling must not open the PDF")
            monkeypatch.setattr("app.papers.pymupdf.open", fail_pdf_open)
            response = owner.get(f"/api/papers/{paper['id']}/status")
            assert response.status_code == 200
            assert response.json() == {"id": paper["id"], "status": "parsed", "warning": paper["warning"]}
            assert other.get(f"/api/papers/{paper['id']}/status").status_code == 404
        finally:
            with SessionLocal() as db:
                for owner_id in users:
                    user = db.get(User, owner_id)
                    if user:
                        db.delete(user)
                db.commit()


def test_missing_pdf_can_be_reattached_without_erasing_history(monkeypatch, tmp_path):
    from app.research import save_artifact
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        owner = None
        try:
            paper = upload(client, "Missing source paper")
            owner = owner_of(client)
            other_paper = upload(client, "Readable comparison paper")
            artifact = save_artifact(owner, "paper_compare", [paper["id"]], {"dimensions": []})
            with SessionLocal() as db:
                stored = db.get(Paper, paper["id"])
                file_path = Path(stored.local_file_path)
                db.add(Message(id="22222222-2222-4222-8222-222222222222", paper_id=paper["id"],
                    role="assistant", content="Previous explanation", reading_unit_id=paper["units"][0]["id"]))
                db.commit()
            file_path.unlink()  # Disposable test fixture, not a user document.
            assert client.get(f"/api/papers/{paper['id']}/file").status_code == 404
            assert client.get(f"/api/papers/{paper['id']}/search", params={"q": "study"}).status_code == 404
            assert client.get(f"/api/papers/{paper['id']}").json()["file_available"] is False
            comparison = client.post("/api/research/compare", json={"paper_ids": [paper["id"], other_paper["id"]]})
            assert comparison.status_code == 422
            assert "PDF 文件不可用" in comparison.json()["detail"]
            invalid = client.post(f"/api/papers/{paper['id']}/attach", files={"file":
                ("invalid.pdf", b"%PDF-invalid", "application/pdf")})
            assert invalid.status_code == 200
            failed = client.get(f"/api/papers/{paper['id']}").json()
            assert failed["status"] == "parsed" and failed["file_available"] is False
            assert failed["messages"][0]["content"] == "Previous explanation"
            assert "重新解析失败" in failed["warning"]
            assert client.get(f"/api/papers/{paper['id']}/search", params={"q": "study"}).status_code == 409
            assert client.post("/api/research/compare", json={"paper_ids": [paper["id"], other_paper["id"]]}).status_code == 422
            replacement = client.post(f"/api/papers/{paper['id']}/attach", files={"file":
                ("replacement.pdf", make_pdf("Unrelated oncology investigation"), "application/pdf")})
            assert replacement.status_code == 200
            after = client.get(f"/api/papers/{paper['id']}").json()
            assert after["status"] == "parsed" and after["file_available"] is True
            assert "标题与原论文记录可能不一致" in after["warning"]
            assert after["messages"][0]["content"] == "Previous explanation"
            assert after["messages"][0]["reading_unit_id"] is None
            saved = client.get("/api/research/artifacts", params={"kind": "paper_compare", "artifact_id": artifact["id"]}).json()
            assert saved[0]["payload"]["stale_after_reparse"] is True
        finally:
            if owner:
                with SessionLocal() as db:
                    user = db.get(User, owner)
                    if user:
                        db.delete(user)
                        db.commit()


def test_chat_waits_for_reparse_to_finish(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        owner = None
        try:
            paper = upload(client, "Parsing in progress paper")
            owner = owner_of(client)
            with SessionLocal() as db:
                db.get(Paper, paper["id"]).status = "reading"
                db.commit()
            response = client.post(f"/api/papers/{paper['id']}/chat", json={"action": "START"})
            assert response.status_code == 409
            assert "解析" in response.json()["detail"]
        finally:
            if owner:
                with SessionLocal() as db:
                    user = db.get(User, owner)
                    if user:
                        db.delete(user)
                        db.commit()


def test_streamed_chat_is_not_saved_if_paper_changes_mid_answer(monkeypatch, tmp_path):
    from uuid import uuid4
    from app.papers import process_paper

    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    monkeypatch.setattr("app.papers.model_config", lambda vision=False: ("unused", "unused", "unused"))
    with TestClient(app) as client:
        paper = upload(client, "Changing Chat Study")
        owner = owner_of(client)
        with SessionLocal() as db:
            path = db.get(Paper, paper["id"]).local_file_path

        async def changing_stream(_messages, *, vision=False, **_kwargs):
            yield {"type": "content", "content": "Old partial answer"}
            token = str(uuid4())
            with SessionLocal() as db:
                record = db.get(Paper, paper["id"])
                record.status, record.parse_token = "uploaded", token
                db.commit()
            process_paper(paper["id"], owner, path, True, token)
            yield {"type": "content", "content": " from old content"}

        monkeypatch.setattr("app.services.bailian_service.stream_events", changing_stream)
        response = client.post(f"/api/papers/{paper['id']}/chat", json={"action": "START"})
        assert response.status_code == 200
        assert '"type": "reset"' in response.text
        assert '"type": "error"' in response.text and "发生变化" in response.text
        assert '"type": "done"' not in response.text
        detail = client.get(f"/api/papers/{paper['id']}").json()
        assert detail["messages"] == [] and detail["current_unit_id"] is None


def test_same_paper_chat_rejects_duplicate_while_other_paper_remains_available(monkeypatch, tmp_path):
    entered = threading.Event()
    release = threading.Event()
    calls = 0

    async def model(_messages, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            await asyncio.to_thread(release.wait, 5)
        yield {"type": "content", "content": "Answer"}

    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    monkeypatch.setattr("app.papers.model_config", lambda vision=False: ("unused", "unused", "unused"))
    monkeypatch.setattr("app.services.bailian_service.stream_events", model)
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as pool:
        first = upload(client, "First Concurrent Chat")
        second = upload(client, "Second Concurrent Chat")
        path = f"/api/papers/{first['id']}/chat"
        body = {"action": "START"}
        active = pool.submit(client.post, path, json=body)
        try:
            assert entered.wait(3)
            assert client.post(path, json={"action": "NEXT"}).status_code == 409
            assert '"type": "done"' in client.post(f"/api/papers/{second['id']}/chat", json=body).text
            assert calls == 2
        finally:
            release.set()
        assert '"type": "done"' in active.result(timeout=4).text
        assert '"type": "done"' in client.post(path, json={"action": "NEXT"}).text


def test_disconnected_chat_closes_model_and_does_not_save_partial_reply(monkeypatch, tmp_path):
    from starlette.requests import ClientDisconnect
    from app import papers

    closed = False

    async def model(_messages, **_kwargs):
        nonlocal closed
        try:
            yield {"type": "content", "content": "Partial"}
            await asyncio.Event().wait()
        finally:
            closed = True

    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    monkeypatch.setattr(papers, "model_config", lambda vision=False: ("unused", "unused", "unused"))
    monkeypatch.setattr("app.services.bailian_service.stream_events", model)
    with TestClient(app) as client:
        paper_id = upload(client, "Disconnected Chat")["id"]
        owner = owner_of(client)

        async def disconnect_after_delta():
            response = await papers.chat(paper_id, papers.ChatRequest(action="START"), owner)

            async def send(message):
                if b'"type": "delta"' in message.get("body", b""):
                    raise OSError("connection closed")

            async def receive():
                await asyncio.Event().wait()

            try:
                await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
            except ClientDisconnect:
                pass

        asyncio.run(disconnect_after_delta())
        assert closed
        assert (owner, paper_id) not in papers._active_chats
        detail = client.get(f"/api/papers/{paper_id}").json()
        assert detail["messages"] == [] and detail["current_unit_id"] is None
def test_pdf_search_stops_after_thirty_matches(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        owner = None
        try:
            paper = upload(client, "Search limit paper")
            owner = owner_of(client)
            pages_read = []

            class FakePage:
                def get_text(self, _format):
                    pages_read.append(1)
                    return "A matching sentence appears on this page."

            class FakeDocument:
                def __enter__(self): return self
                def __exit__(self, *_args): return False
                def __iter__(self): return iter(FakePage() for _ in range(100))

            monkeypatch.setattr("app.papers.pymupdf.open", lambda *_args, **_kwargs: FakeDocument())
            response = client.get(f"/api/papers/{paper['id']}/search", params={"q": "matching"})
            assert response.status_code == 200
            assert len(response.json()) == 30
            assert len(pages_read) == 30
        finally:
            if owner:
                with SessionLocal() as db:
                    user = db.get(User, owner)
                    if user:
                        db.delete(user)
                        db.commit()


def test_readable_short_pdf_is_not_misreported_as_scanned(tmp_path):
    path = tmp_path / "readable-short.pdf"
    path.write_bytes(make_pdf("Readable short paper"))
    parsed = parse_pdf(path)
    assert not parsed.warning or "扫描页" not in parsed.warning


def test_mixed_pdf_reports_pages_without_a_text_layer(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page()
    for i, text in enumerate(("Abstract", "A readable abstract contains important details about the research question.",
                              "Methods", "This study compares a treatment group and a control group.",
                              "Results", "The measured response changed in the treatment group.")):
        page.insert_text((40, 50 + i * 25), text, fontsize=10)
    doc.new_page()  # A page with no text layer, as in an image-only scan.
    path = tmp_path / "mixed.pdf"
    path.write_bytes(doc.tobytes())
    doc.close()
    parsed = parse_pdf(path)
    assert "有 1 页可提取文字很少" in parsed.warning
    assert "未做 OCR" in parsed.warning


def test_synchronous_upload_does_not_block_other_requests(monkeypatch, tmp_path):
    import asyncio
    import threading
    import httpx

    started, release, completed = threading.Event(), threading.Event(), threading.Event()
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)

    def slow_parse(*_args, **_kwargs):
        started.set()
        release.wait(3)
        completed.set()

    monkeypatch.setattr("app.papers.process_paper", slow_parse)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
            task = asyncio.create_task(client.post("/api/papers", files={"file": ("test.pdf", make_pdf("Concurrent paper"), "application/pdf")}))
            try:
                assert await asyncio.to_thread(started.wait, 2)
                assert not completed.is_set(), "PDF parse blocked the event loop until it finished"
                response = await asyncio.wait_for(client.get("/api/health"), timeout=1)
                assert response.status_code == 200
            finally:
                release.set()
                await task
                token = client.cookies.get(COOKIE_NAME)
                if token:
                    with SessionLocal() as db:
                        user = db.scalar(select(User).where(User.session_hash == session_hash(token)))
                        if user:
                            db.delete(user)
                            db.commit()

    with TestClient(app):
        asyncio.run(exercise())


def test_figure_rendering_runs_outside_event_loop(monkeypatch, tmp_path):
    import asyncio
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    monkeypatch.setattr("app.papers.model_config", lambda vision=False: ("unused", "unused", "unused"))
    rendering_in_event_loop = []

    def fake_render(*_args, **_kwargs):
        try:
            asyncio.get_running_loop()
            rendering_in_event_loop.append(True)
        except RuntimeError:
            rendering_in_event_loop.append(False)
        return b"synthetic image"

    async def fake_stream(_messages, *, vision=False, **_kwargs):
        yield {"type": "content", "content": "Test visual explanation"}

    monkeypatch.setattr("app.papers.render_page_png", fake_render)
    monkeypatch.setattr("app.services.bailian_service.stream_events", fake_stream)
    with TestClient(app) as client:
        owner = None
        try:
            paper = upload(client, "Figure rendering paper")
            owner = owner_of(client)
            figure = next(unit for unit in paper["units"] if unit["kind"] == "FIGURE")
            response = client.post(f"/api/papers/{paper['id']}/chat", json={"action": "NAVIGATE", "unit_id": figure["id"]})
            assert response.status_code == 200
            assert '"visual_verified": true' in response.text
            assert rendering_in_event_loop == [False]
        finally:
            if owner:
                with SessionLocal() as db:
                    user = db.get(User, owner)
                    if user:
                        db.delete(user)
                        db.commit()


def test_persistent_cookie_ownership_and_history(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    monkeypatch.setattr("app.papers.model_config", lambda vision=False: ("unused", "unused", "unused"))
    calls = []

    async def fake_stream(messages, *, vision=False, **_kwargs):
        calls.append((messages, vision))
        yield {"type": "content", "content": "已根据当前论文证据回答。"}

    monkeypatch.setattr("app.services.bailian_service.stream_events", fake_stream)
    owners = []
    with TestClient(app) as a, TestClient(app) as b:
        try:
            first = a.get("/api/session")
            assert first.status_code == 200
            cookie = first.headers["set-cookie"]
            assert "httponly" in cookie.lower() and f"Max-Age={COOKIE_AGE}" in cookie
            paper_a = upload(a, "Cellular Injury Study A")
            paper_a2 = upload(a, "Cellular Injury Study A2")
            paper_b = upload(b, "Cellular Injury Study B")
            owners = [owner_of(a), owner_of(b)]
            assert owners[0] != owners[1]
            with SessionLocal() as db:
                assert db.get(Paper, paper_a["id"]).owner_id == owners[0]
                assert db.get(Paper, paper_b["id"]).owner_id == owners[1]
            assert {item["id"] for item in a.get("/api/papers").json()} == {paper_a["id"], paper_a2["id"]}
            assert {item["id"] for item in b.get("/api/papers").json()} == {paper_b["id"]}
            for client, foreign in ((a, paper_b), (b, paper_a)):
                pid = foreign["id"]
                for route in (f"/api/papers/{pid}", f"/api/papers/{pid}/file", f"/api/papers/{pid}/manifest", f"/api/papers/{pid}/search?q=signal", f"/api/papers/{pid}/pages/1/thumbnail"):
                    assert client.get(route).status_code == 404
                assert client.post(f"/api/papers/{pid}/chat", json={"action": "START"}).status_code == 404
                assert client.delete(f"/api/papers/{pid}").status_code == 404
            assert a.get(f"/api/papers/{paper_a['id']}/file").content.startswith(b"%PDF-")
            assert a.get(f"/api/papers/{paper_a['id']}/pages/1/thumbnail").content.startswith(b"\x89PNG")
            assert a.get(f"/api/papers/{paper_a['id']}/search?q=Treatment").json()
            pdf_path = next((tmp_path / owners[0] / paper_a["id"]).glob("*.pdf"))
            assert render_page_png(pdf_path, 1).startswith(b"\x89PNG")
            units = paper_a["units"]
            assert [unit["kind"] for unit in units] == ["TITLE", "ABSTRACT", "INTRODUCTION", "METHODS", "FIGURE", "RESULTS", "DISCUSSION", "CONCLUSION", "RECAP"]
            assert units[4]["actual_pdf_page"] == 1 and units[4]["figure_number"] == "1"
            chat_a = a.post(f"/api/papers/{paper_a['id']}/chat", json={"action": "START"})
            assert chat_a.status_code == 200 and '"type": "done"' in chat_a.text
            assert a.get(f"/api/papers/{paper_a['id']}").json()["current_unit_id"] == units[1]["id"]
            assert "标题原文" in str(calls[-1][0]) and "摘要原文" in str(calls[-1][0])
            assert "题目与摘要" in str(calls[-1][0])
            assert a.post(f"/api/papers/{paper_a['id']}/chat", json={"action": "NEXT"}).status_code == 200
            assert a.get(f"/api/papers/{paper_a['id']}").json()["current_unit_id"] == units[2]["id"]
            a.post(f"/api/papers/{paper_a['id']}/chat", json={"action": "NAVIGATE", "unit_id": units[4]["id"]})
            assert all("已根据当前论文证据回答" not in str(message) for message in calls[-1][0])
            a.post(f"/api/papers/{paper_a['id']}/chat", json={"action": "QUESTION", "message": "这个结果可靠吗？"})
            assert any("已根据当前论文证据回答" in str(message) for message in calls[-1][0])
            detail = a.get(f"/api/papers/{paper_a['id']}").json()
            assert detail["current_unit_id"] == units[4]["id"]
            assert any(item["visual_verified"] is True for item in detail["messages"] if item["role"] == "assistant")
            assert a.get(f"/api/papers/{paper_a2['id']}").json()["messages"] == []
            assert b.get(f"/api/papers/{paper_b['id']}").json()["messages"] == []
            assert b.post(f"/api/papers/{paper_b['id']}/chat", json={"action": "START"}).status_code == 200
            assert "Cellular Injury Study B" in str(calls[-1][0])
            assert "Cellular Injury Study A" not in str(calls[-1][0])
            assert a.post(f"/api/papers/{paper_a2['id']}/chat", json={"action": "START"}).status_code == 200
            assert "Cellular Injury Study A2" in str(calls[-1][0])
            assert "Cellular Injury Study B" not in str(calls[-1][0])
            assert len(b.get(f"/api/papers/{paper_b['id']}").json()["messages"]) == 2
            assert len(a.get(f"/api/papers/{paper_a2['id']}").json()["messages"]) == 2
            with TestClient(app, cookies={COOKIE_NAME: a.cookies.get(COOKIE_NAME)}) as reopened:
                restored = reopened.get(f"/api/papers/{paper_a['id']}").json()
                assert restored["current_unit_id"] == units[4]["id"]
                assert len(restored["messages"]) == len(detail["messages"])
            with TestClient(app) as cleared:
                assert cleared.get("/api/papers").json() == []
                owners.append(owner_of(cleared))
            assert a.delete(f"/api/papers/{paper_a2['id']}").status_code == 200
            assert a.post(f"/api/papers/{paper_a['id']}/chat", headers={"Origin": "http://127.0.0.1:9999"}, json={"action": "START"}).status_code == 403
        finally:
            with SessionLocal() as db:
                for owner in owners:
                    user = db.get(User, owner)
                    if user:
                        db.delete(user)
                db.commit()


def test_results_table_and_text_fallback(tmp_path):
    table_path = tmp_path / "table.pdf"
    table_path.write_bytes(make_pdf("Clinical Table Study", figure=False, table=True))
    table_units = parse_pdf(table_path).units
    assert any(item.kind == "TABLE" for item in table_units)
    assert not any(item.kind == "FIGURE" for item in table_units)
    text_path = tmp_path / "text.pdf"
    text_path.write_bytes(make_pdf("Clinical Text Study", figure=False))
    assert any(item.kind == "RESULTS" for item in parse_pdf(text_path).units)
    doc = pymupdf.open()
    page = doc.new_page()
    for index, line in enumerate(("Outcome Study", "Abstract", "Overview.", "Methods", "Study design.",
                                  "Results", "Primary outcome", "Response improved.",
                                  "Secondary outcome", "Safety was measured.", "Discussion", "Uncertain.")):
        page.insert_text((50, 40 + index * 30), line, fontsize=12)
    path = tmp_path / "subheads.pdf"
    path.write_bytes(doc.tobytes())
    doc.close()
    headings = [unit.heading for unit in parse_pdf(path).units if unit.kind == "RESULTS"]
    assert "Primary outcome" in headings and "Secondary outcome" in headings

    both_path = tmp_path / "figure-and-table.pdf"
    both_path.write_bytes(make_pdf("Figure and Table Study", figure=True, table=True))
    kinds = [unit.kind for unit in parse_pdf(both_path).units]
    assert kinds.index("FIGURE") < kinds.index("TABLE") < kinds.index("RESULTS") < kinds.index("DISCUSSION")


def test_title_prefers_prominent_text_over_copyright_notice(tmp_path):
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((50, 70), "Provided proper attribution is provided, permission to reproduce", fontsize=11)
    page.insert_text((50, 130), "Attention Is All You Need", fontsize=18)
    page.insert_text((50, 180), "Abstract", fontsize=12)
    page.insert_text((50, 210), "A new model is described.", fontsize=12)
    path = tmp_path / "notice.pdf"
    path.write_bytes(document.tobytes())
    document.close()
    assert parse_pdf(path).title == "Attention Is All You Need"


def test_author_manuscript_header_does_not_replace_title_or_hide_sections(tmp_path):
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((50, 45), "HHS Public Access", fontsize=20)
    page.insert_text((50, 82), "Author Manuscript", fontsize=16)
    page.insert_text((50, 135), "Yap-Sox9 signaling determines hepatocyte plasticity", fontsize=15)
    for index, line in enumerate(("Abstract", "This study examines liver cell fate and lineage plasticity.",
                                  "Introduction", "The biological question is unresolved.",
                                  "Methods", "The authors compared genetic perturbations.",
                                  "Results", "The observed response changed after perturbation.")):
        page.insert_text((50, 190 + index * 27), line, fontsize=10)
    path = tmp_path / "nih-manuscript.pdf"
    path.write_bytes(document.tobytes())
    document.close()
    parsed = parse_pdf(path)
    assert parsed.title == "Yap-Sox9 signaling determines hepatocyte plasticity"
    assert {item.kind for item in parsed.units} >= {"ABSTRACT", "INTRODUCTION", "METHODS", "RESULTS"}


def test_reparse_preserves_history_and_marks_results_stale(monkeypatch, tmp_path):
    from app.research import save_artifact
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        owner = None
        try:
            uploaded = upload(client, "Reparse Example")
            owner = owner_of(client)
            before = client.get(f"/api/papers/{uploaded['id']}").json()
            saved = save_artifact(owner, "paper_compare", [uploaded["id"]], {"dimensions": []})
            with SessionLocal() as db:
                db.add(Message(
                    id="11111111-1111-4111-8111-111111111111", paper_id=uploaded["id"],
                    role="assistant", content="Old reading", reading_unit_id=before["units"][0]["id"]))
                db.commit()
            response = client.post(f"/api/papers/{uploaded['id']}/reparse")
            assert response.status_code == 200
            after = client.get(f"/api/papers/{uploaded['id']}").json()
            assert after["status"] == "parsed"
            assert len(after["units"]) == len(before["units"])
            assert after["messages"][0]["content"] == "Old reading"
            assert after["messages"][0]["reading_unit_id"] is None
            artifacts = client.get("/api/research/artifacts", params={"kind": "paper_compare", "artifact_id": saved["id"]}).json()
            assert artifacts[0]["payload"]["stale_after_reparse"] is True
        finally:
            if owner:
                with SessionLocal() as db:
                    user = db.get(User, owner)
                    if user:
                        db.delete(user)
                        db.commit()


def test_precompute_failure_does_not_invalidate_successful_parse(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)

    def fail_precompute(*_args):
        raise RuntimeError("queue unavailable")

    monkeypatch.setattr("app.jobs.precompute.schedule_for_paper", fail_precompute)
    with TestClient(app) as client:
        paper = upload(client, "Precompute Failure Study")
        assert paper["status"] == "parsed" and paper["units"]
        response = client.post(f"/api/papers/{paper['id']}/reparse")
        assert response.status_code == 200
        after = client.get(f"/api/papers/{paper['id']}").json()
        assert after["status"] == "parsed" and after["units"]
        assert not (after["warning"] or "").startswith("重新解析失败")


def test_failed_record_keeps_previous_units_when_replacement_fails(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        paper = upload(client, "Previously Read Study")
        with SessionLocal() as db:
            db.get(Paper, paper["id"]).status = "failed"
            db.commit()
        response = client.post(f"/api/papers/{paper['id']}/attach", files={"file":
            ("broken.pdf", b"%PDF-broken", "application/pdf")})
        assert response.status_code == 200
        after = client.get(f"/api/papers/{paper['id']}").json()
        assert after["status"] == "parsed"
        assert after["units"] == paper["units"]
        assert "重新解析失败" in after["warning"]


def test_failed_replacement_never_pairs_old_units_with_new_pdf(monkeypatch, tmp_path):
    import asyncio
    from fastapi import HTTPException
    from app import papers as papers_module
    from app.research import fulltext_papers
    from app.services.mindmap_service import execute_mindmap
    import pytest

    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        paper = upload(client, "Original Study")
        owner = owner_of(client)
        with SessionLocal() as db:
            # Simulate a missing original without deleting any file.
            record = db.get(Paper, paper["id"])
            record.local_file_path = str(tmp_path / "missing.pdf")
            db.commit()
        original_parse = papers_module.parse_pdf

        def fail_parse(*_args, **_kwargs):
            raise ValueError("simulated parsing failure")

        monkeypatch.setattr(papers_module, "parse_pdf", fail_parse)
        response = client.post(f"/api/papers/{paper['id']}/attach", files={"file":
            ("replacement.pdf", make_pdf("Different Study"), "application/pdf")})
        assert response.status_code == 200
        after = client.get(f"/api/papers/{paper['id']}").json()
        assert after["units"] == paper["units"]
        assert after["source_matches"] is False and after["file_available"] is False
        assert after["full_text_available"] is False
        assert client.get(f"/api/papers/{paper['id']}/file").status_code == 409
        assert client.get(f"/api/papers/{paper['id']}/search", params={"q": "study"}).status_code == 409
        assert client.post(f"/api/papers/{paper['id']}/chat", json={"action": "START"}).status_code == 409
        with pytest.raises(HTTPException) as error:
            fulltext_papers(owner, [paper["id"]])
        assert error.value.status_code == 422
        with pytest.raises(ValueError, match="不一致"):
            asyncio.run(execute_mindmap(owner, paper["id"]))
        monkeypatch.setattr(papers_module, "parse_pdf", original_parse)
        assert client.post(f"/api/papers/{paper['id']}/reparse").status_code == 200
        restored = client.get(f"/api/papers/{paper['id']}").json()
        assert restored["source_matches"] is True and restored["file_available"] is True
        assert client.get(f"/api/papers/{paper['id']}/file").status_code == 200


def test_failed_reparse_of_same_file_retains_source_match(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        paper = upload(client, "Same Source Study")

        def fail_parse(*_args, **_kwargs):
            raise ValueError("simulated parsing failure")

        monkeypatch.setattr("app.papers.parse_pdf", fail_parse)
        assert client.post(f"/api/papers/{paper['id']}/reparse").status_code == 200
        after = client.get(f"/api/papers/{paper['id']}").json()
        assert after["source_matches"] is True and after["file_available"] is True
        assert after["units"] == paper["units"]
        assert client.get(f"/api/papers/{paper['id']}/file").status_code == 200


def test_simultaneous_attachments_only_start_one_parse(monkeypatch, tmp_path):
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from app import papers as papers_module

    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        paper = upload(client, "Concurrent Attachment Study")
        with SessionLocal() as db:
            db.get(Paper, paper["id"]).status = "failed"
            db.commit()
        original_save = papers_module.save_pdf
        barrier = Barrier(2)

        async def synchronized_save(*args):
            result = await original_save(*args)
            await asyncio.to_thread(barrier.wait, 5)
            return result

        monkeypatch.setattr(papers_module, "save_pdf", synchronized_save)

        def attach(title):
            return client.post(f"/api/papers/{paper['id']}/attach", files={"file":
                ("paper.pdf", make_pdf(title), "application/pdf")})

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(attach, ["Replacement One", "Replacement Two"]))
        assert sorted(response.status_code for response in responses) == [200, 409]
        after = client.get(f"/api/papers/{paper['id']}").json()
        assert after["status"] == "parsed" and after["units"]


def test_stale_parse_recovers_and_preserves_history(monkeypatch, tmp_path):
    from datetime import datetime, timedelta, timezone
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        paper = upload(client, "Recovered Study")
        with SessionLocal() as db:
            record = db.get(Paper, paper["id"])
            record.status = "reading"
            record.parse_token = "old-attempt"
            record.parse_heartbeat = datetime.now(timezone.utc) - timedelta(hours=1)
            db.add(Message(id="21111111-1111-4111-8111-111111111111", paper_id=paper["id"],
                           role="assistant", content="Keep this note", reading_unit_id=paper["units"][0]["id"]))
            db.commit()
        response = client.get(f"/api/papers/{paper['id']}/status")
        assert response.status_code == 200 and response.json()["status"] == "uploaded"
        after = client.get(f"/api/papers/{paper['id']}").json()
        assert after["status"] == "parsed" and after["units"]
        assert after["messages"][0]["content"] == "Keep this note"
        assert after["messages"][0]["reading_unit_id"] is None


@pytest.mark.parametrize("prior_token", ["interrupted-attempt", None])
def test_restart_resumes_pdf_parse_without_a_status_request(monkeypatch, tmp_path, prior_token):
    from datetime import datetime, timezone
    from threading import Event
    from time import monotonic, sleep

    from app import papers as papers_module
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as first:
        paper = upload(first, "Restart Recovery Study")
        cookie = first.cookies.get(COOKIE_NAME)
        with SessionLocal() as db:
            record = db.get(Paper, paper["id"])
            record.status = "reading"
            record.parse_token = prior_token
            record.parse_heartbeat = datetime.now(timezone.utc) if prior_token else None
            db.add(Message(id=str(uuid4()), paper_id=paper["id"], role="assistant",
                           content="Keep this note", reading_unit_id=paper["units"][0]["id"]))
            db.commit()

    original = papers_module.parse_pdf
    started, release = Event(), Event()

    def hold_recovery(path, **options):
        started.set()
        assert release.wait(5)
        return original(path, **options)

    monkeypatch.setattr(papers_module, "parse_pdf", hold_recovery)
    with TestClient(app) as restarted:
        restarted.cookies.set(COOKIE_NAME, cookie)
        try:
            assert started.wait(3), "startup must resume parsing without a browser status request"
            assert restarted.get("/api/health").status_code == 200
        finally:
            release.set()
        deadline = monotonic() + 5
        while monotonic() < deadline:
            result = restarted.get(f"/api/papers/{paper['id']}").json()
            if result["status"] == "parsed":
                break
            sleep(.02)
        assert result["status"] == "parsed" and result["units"]
        assert result["messages"][0]["content"] == "Keep this note"
        assert result["messages"][0]["reading_unit_id"] is None


def test_live_or_legacy_parse_is_not_restarted(monkeypatch, tmp_path):
    from datetime import datetime, timedelta, timezone
    from app import papers as papers_module
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        paper = upload(client, "Live Parse Study")
        monkeypatch.setattr(papers_module, "process_paper", lambda *_args: (_ for _ in ()).throw(AssertionError("unexpected restart")))
        for token, age in [("live-attempt", timedelta(seconds=10)), (None, timedelta(days=1))]:
            with SessionLocal() as db:
                record = db.get(Paper, paper["id"])
                record.status = "reading"
                record.parse_token = token
                record.parse_heartbeat = datetime.now(timezone.utc) - age
                db.commit()
            assert client.get(f"/api/papers/{paper['id']}/status").json()["status"] == "reading"


def test_superseded_parse_cannot_overwrite_new_attempt(monkeypatch, tmp_path):
    from datetime import datetime, timezone
    from threading import Event, Thread
    from app import papers as papers_module
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        paper = upload(client, "Fence Study")
        owner = owner_of(client)
        with SessionLocal() as db:
            record = db.get(Paper, paper["id"])
            path = record.local_file_path
            record.status, record.parse_token = "reading", "old-attempt"
            record.parse_heartbeat = datetime.now(timezone.utc)
            db.commit()
        started, release = Event(), Event()
        original_extract = papers_module.extract_embedded_images

        def delayed_extract(path, *, generation):
            started.set()
            assert release.wait(5)
            return original_extract(path, generation=generation)

        monkeypatch.setattr(papers_module, "extract_embedded_images", delayed_extract)
        thread = Thread(target=papers_module.process_paper,
                        args=(paper["id"], owner, path, True, "old-attempt"))
        thread.start()
        try:
            assert started.wait(5)
            with SessionLocal() as db:
                record = db.get(Paper, paper["id"])
                record.status, record.parse_token = "uploaded", "new-attempt"
                record.title = "New attempt owns this record"
                db.commit()
        finally:
            release.set()
            thread.join(5)
        assert not thread.is_alive()
        with SessionLocal() as db:
            record = db.get(Paper, paper["id"])
            assert record.parse_token == "new-attempt"
            assert record.title == "New attempt owns this record"
            assert record.status == "uploaded"


def test_figures_after_references_are_not_main_results(tmp_path):
    document = pymupdf.open()
    first = document.new_page()
    for index, line in enumerate(("A cross-domain algorithm paper", "Abstract", "Overview.", "Results",
                                  "Figure 1: Main result.", "Discussion", "Evidence remains limited.")):
        first.insert_text((50, 50 + index * 35), line, fontsize=12)
    appendix = document.new_page()
    appendix.insert_text((50, 50), "References", fontsize=12)
    appendix.insert_text((50, 90), "Figure 2: Appendix visualization.", fontsize=12)
    path = tmp_path / "appendix.pdf"
    path.write_bytes(document.tobytes())
    document.close()
    figures = [unit.heading for unit in parse_pdf(path).units if unit.kind == "FIGURE"]
    assert figures == ["Figure 1"]


def test_deferred_parse_and_safe_ai_error(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    monkeypatch.setattr("app.papers.model_config", lambda vision=False: ("unused", "unused", "unused"))

    async def failing_stream(_messages, *, vision=False, **_kwargs):
        raise RuntimeError("internal-secret-from-provider")
        yield {"type": "content", "content": "unused"}

    monkeypatch.setattr("app.services.bailian_service.stream_events", failing_stream)
    with TestClient(app) as client:
        owner = None
        try:
            response = client.post("/api/papers?deferred=true", files={"file": ("paper.pdf", make_pdf("Deferred Paper"), "application/pdf")})
            assert response.status_code == 200
            paper_id = response.json()["id"]
            owner = owner_of(client)
            detail = client.get(f"/api/papers/{paper_id}").json()
            assert detail["status"] == "parsed" and detail["page_count"] == 1
            result = client.post(f"/api/papers/{paper_id}/chat", json={"action": "START"})
            assert '"type": "error"' in result.text
            assert "AI 服务暂时不可用" in result.text
            assert "internal-secret-from-provider" not in result.text
            restored = client.get(f"/api/papers/{paper_id}").json()
            assert restored["current_unit_id"] is None and restored["messages"] == []
        finally:
            if owner:
                with SessionLocal() as db:
                    db.delete(db.get(User, owner))
                    db.commit()


def test_visual_failure_has_safe_text_fallback(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    monkeypatch.setattr("app.papers.model_config", lambda vision=False: ("unused", "unused", "unused"))

    async def fake_stream(_messages, *, vision=False, **_kwargs):
        if vision:
            raise RuntimeError("internal-secret-from-provider")
        yield {"type": "content", "content": "根据正文和图注，这项比较有待验证。"}

    monkeypatch.setattr("app.services.bailian_service.stream_events", fake_stream)
    owner = None
    with TestClient(app) as client:
        try:
            paper = upload(client, "Fallback Study")
            owner = owner_of(client)
            figure = next(unit for unit in paper["units"] if unit["kind"] == "FIGURE")
            response = client.post(f"/api/papers/{paper['id']}/chat", json={"action": "NAVIGATE", "unit_id": figure["id"]})
            assert response.status_code == 200 and '"visual_verified": false' in response.text
            assert "internal-secret-from-provider" not in response.text
            detail = client.get(f"/api/papers/{paper['id']}").json()
            assert all(item["visual_verified"] is False for item in detail["messages"] if item["role"] == "assistant")
        finally:
            if owner:
                with SessionLocal() as db:
                    db.delete(db.get(User, owner))
                    db.commit()
