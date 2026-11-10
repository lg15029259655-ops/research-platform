from pathlib import Path

import pymupdf
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


def upload(client: TestClient, title: str, **kwargs) -> dict:
    response = client.post("/api/papers", files={"file": ("unrelated-name.pdf", make_pdf(title, **kwargs), "application/pdf")})
    assert response.status_code == 200, response.text
    return response.json()


def owner_of(client: TestClient) -> str:
    with SessionLocal() as db:
        return db.scalar(select(User).where(User.session_hash == session_hash(client.cookies.get(COOKIE_NAME)))).id


def test_persistent_cookie_ownership_and_history(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    monkeypatch.setattr("app.papers.model_config", lambda vision=False: ("unused", "unused", "unused"))
    calls = []

    async def fake_stream(messages, *, vision=False):
        calls.append((messages, vision))
        yield "已根据当前论文证据回答。"

    monkeypatch.setattr("app.papers.stream_completion", fake_stream)
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

    async def failing_stream(_messages, *, vision=False):
        raise RuntimeError("internal-secret-from-provider")
        yield "unused"

    monkeypatch.setattr("app.papers.stream_completion", failing_stream)
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

    async def fake_stream(_messages, *, vision=False):
        if vision:
            raise RuntimeError("internal-secret-from-provider")
        yield "根据正文和图注，这项比较有待验证。"

    monkeypatch.setattr("app.papers.stream_completion", fake_stream)
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
