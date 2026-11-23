import pymupdf
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import COOKIE_NAME, session_hash
from app.db import SessionLocal
from app.main import app
from app.models import User
from app.research import route_research, save_artifact
from app.services.research_ai import Comparison, parse_json, StructuredAIError
from app.services.openalex_service import abstract_text, normalize_work
from app.services.openalex_service import DiscoveryRateLimited, search_works
from app.services.remote_pdf import public_https


def pdf_bytes(title: str) -> bytes:
    document = pymupdf.open()
    page = document.new_page()
    for index, line in enumerate((title, "Abstract", "Measured effect.", "Methods", "Control and treatment.",
                                  "Results", "Treatment changed response.", "Figure 1. Response by condition.",
                                  "Discussion", "The evidence is limited.")):
        page.insert_text((50, 50 + index * 35), line, fontsize=12)
    data = document.tobytes()
    document.close()
    return data


def test_preparing_comparison_does_not_block_event_loop(monkeypatch):
    import asyncio
    import threading
    from app import research

    started, release = threading.Event(), threading.Event()

    def slow_fulltext(*_args, **_kwargs):
        started.set()
        assert release.wait(5)
        raise ValueError("stop after preparation")

    monkeypatch.setattr(research, "fulltext_papers", slow_fulltext)

    async def exercise():
        task = asyncio.create_task(research.execute_compare("owner", ["a", "b"]))
        try:
            assert await asyncio.wait_for(asyncio.to_thread(started.wait, 2), timeout=3)
            # This timer could not fire while the event loop ran the blocking
            # PDF preparation itself.
            await asyncio.wait_for(asyncio.sleep(0.02), timeout=0.5)
        finally:
            release.set()
        try:
            await task
        except ValueError as exc:
            assert str(exc) == "stop after preparation"
        else:
            raise AssertionError("expected the preparation sentinel")

    asyncio.run(exercise())


def test_comparison_rejects_result_if_paper_is_reparsed_during_generation(monkeypatch, tmp_path):
    from uuid import uuid4
    from app.models import Paper, ResearchArtifact
    from app.papers import process_paper

    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)

    async def fake_run(_name, context):
        paper_id = context["papers"][0]["paper_id"]
        with SessionLocal() as db:
            paper = db.get(Paper, paper_id)
            owner, path, token = paper.owner_id, paper.local_file_path, str(uuid4())
            paper.status, paper.parse_token = "uploaded", token
            db.commit()
        process_paper(paper_id, owner, path, True, token)
        return {"papers": [], "dimensions": [], "controversies": [{
            "claim": "Old result", "paper_ids": [paper_id], "stance": "INSUFFICIENT",
            "reason": "Old source", "evidence_refs": []}]}

    monkeypatch.setattr("app.research.run_task", fake_run)
    with TestClient(app) as client:
        try:
            ids = [client.post("/api/papers", files={"file":
                (f"paper-{n}.pdf", pdf_bytes(f"Reparse Comparison {n}"), "application/pdf")}).json()["id"]
                for n in (1, 2)]
            result = client.post("/api/research/compare", json={"paper_ids": ids})
            assert result.status_code == 409
            assert "发生变化" in result.json()["detail"]
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(
                    User.session_hash == session_hash(client.cookies.get(COOKIE_NAME)))).id
                assert db.scalar(select(ResearchArtifact).where(
                    ResearchArtifact.owner_id == owner, ResearchArtifact.kind == "paper_compare")) is None
        finally:
            clean(client)


def test_comparison_rejects_pdf_without_readable_sections(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((50, 60), "HHS Public Access", fontsize=20)
    page.insert_text((50, 120), "Publisher notice only", fontsize=12)
    unreadable = document.tobytes()
    document.close()
    with TestClient(app) as client:
        try:
            good = client.post("/api/papers", files={"file": ("good.pdf", pdf_bytes("Good comparison paper"), "application/pdf")}).json()
            bad = client.post("/api/papers", files={"file": ("bad.pdf", unreadable, "application/pdf")}).json()
            response = client.post("/api/research/compare", json={"paper_ids": [good["id"], bad["id"]]})
            assert response.status_code == 422
            assert "bad.pdf" in response.json()["detail"]
        finally:
            clean(client)


def test_multipage_review_fallback_preserves_evidence_anchor(monkeypatch, tmp_path):
    from app.models import ReadingUnit
    from app.research import fulltext_papers

    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        try:
            paper = client.post("/api/papers", files={"file": ("review.pdf", pdf_bytes("Review paper"), "application/pdf")}).json()
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(User.session_hash == session_hash(client.cookies.get(COOKIE_NAME)))).id
                units = db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id == paper["id"])).all()
                abstract = next(unit for unit in units if unit.kind == "ABSTRACT")
                for unit in units:
                    if unit.id != abstract.id:
                        db.delete(unit)
                abstract.source_text = "Review body evidence. " * 600
                abstract.page_start, abstract.page_end = 1, 6
                anchor = abstract.id
                db.commit()
            result = fulltext_papers(owner, [paper["id"]], compact=True)[0]
            assert len(result["sections"]) == 3
            assert all(section["unit_id"] == anchor and section["kind"] == "UNCLASSIFIED" and section["page"] is None for section in result["sections"])
        finally:
            clean(client)


def test_comparison_samples_unclassified_review_pages_with_real_page_numbers(monkeypatch, tmp_path):
    from app.models import ReadingUnit
    from app.research import fulltext_papers

    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        try:
            paper = client.post("/api/papers", files={"file": ("review.pdf", pdf_bytes("Review paper"), "application/pdf")}).json()
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(User.session_hash == session_hash(client.cookies.get(COOKIE_NAME)))).id
                db.query(ReadingUnit).filter(ReadingUnit.paper_id == paper["id"]).delete()
                for index in range(5):
                    db.add(ReadingUnit(id=f"{paper['id']}:body:{index}", paper_id=paper["id"], position=index,
                        kind="BODY", heading=f"未分类正文 {index + 1}", page_start=index + 1,
                        page_end=index + 1, source_text="Review evidence " * 15))
                db.commit()
            sections = fulltext_papers(owner, [paper["id"]], compact=True)[0]["sections"]
            assert [section["page"] for section in sections] == [1, 3, 5]
            assert all(section["kind"] == "BODY" and section["unit_id"].endswith(f":{section['page'] - 1}") for section in sections)
        finally:
            clean(client)


def clean(client: TestClient):
    for paper in client.get("/api/papers").json():
        client.delete(f"/api/papers/{paper['id']}")
    token = client.cookies.get(COOKIE_NAME)
    if token:
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.session_hash == session_hash(token)))
            if user:
                db.delete(user)
                db.commit()


def test_novelty_timeout_keeps_real_search_hits(monkeypatch):
    import asyncio

    async def found(*_args, **_kwargs):
        return {"items": [{"openalex_id": "W123", "title": "Real paper", "abstract": "Measured response",
            "year": 2020}], "cached": False, "fetched_at": "2026-01-01T00:00:00+00:00"}

    async def slow_run(*_args, **_kwargs):
        await asyncio.sleep(0.1)

    monkeypatch.setattr("app.research.cached_discovery", found)
    monkeypatch.setattr("app.research.run_task", slow_run)
    monkeypatch.setattr("app.research.NOVELTY_AI_TIMEOUT", 0.001)
    with TestClient(app) as client:
        try:
            response = client.post("/api/research/novelty", json={"query": "Test research idea"})
            assert response.status_code == 200
            result = response.json()["payload"]
            assert result["search_only"] is True
            assert result["similar_papers"][0]["openalex_id"] == "W123"
            assert result["similar_papers"][0]["abstract"] == "Measured response"
        finally:
            clean(client)


def test_design_timeout_returns_labelled_quick_draft(monkeypatch):
    import asyncio

    async def slow_run(*_args, **_kwargs):
        await asyncio.sleep(0.1)

    monkeypatch.setattr("app.research.run_task", slow_run)
    monkeypatch.setattr("app.research.DESIGN_AI_TIMEOUT", 0.001)
    with TestClient(app) as client:
        try:
            response = client.post("/api/research/design", json={"goal": "Test a practical hypothesis"})
            assert response.status_code == 200
            result = response.json()["payload"]
            assert result["goal"] == "Test a practical hypothesis"
            assert "快速设计草稿" in result["change_summary"]
            assert len(result["nodes"]) >= 3
        finally:
            clean(client)


def test_design_repeated_click_reuses_version_and_history_is_scoped(monkeypatch):
    calls = []

    async def fake_run(_name, context):
        calls.append(context["goal"])
        return {"goal": context["goal"], "change_summary": "初稿", "constraints": [],
            "nodes": [{"id": "N1", "label": "问题", "type": "question", "detail": "待核验"}],
            "edges": [], "controls": [], "readouts": [], "assumptions": []}

    monkeypatch.setattr("app.research.run_task", fake_run)
    with TestClient(app) as client:
        try:
            first = client.post("/api/research/design", json={"goal": "First test idea"}).json()
            repeated = client.post("/api/research/design", json={"goal": "First test idea"}).json()
            assert repeated["id"] == first["id"]
            assert len(calls) == 1
            forced = client.post("/api/research/design", json={"goal": "First test idea", "regenerate": True}).json()
            assert forced["id"] != first["id"]
            client.post("/api/research/design", json={"goal": "Second test idea"})
            scoped = client.get("/api/research/design/versions", params={"goal": "First test idea"}).json()
            assert len(scoped) == 2
            assert {item["payload"]["goal"] for item in scoped} == {"First test idea"}
        finally:
            clean(client)


def test_simultaneous_designs_do_not_overwrite_each_other(monkeypatch):
    import asyncio
    from fastapi import HTTPException
    from app import research

    async def exercise(owner):
        entered = 0
        both_started = asyncio.Event()

        async def delayed_run(_name, context):
            nonlocal entered
            entered += 1
            if entered == 2:
                both_started.set()
            await asyncio.wait_for(both_started.wait(), 3)
            return research.quick_design(context["goal"], "")

        monkeypatch.setattr(research, "run_task", delayed_run)
        request = research.DesignRequest(goal="Concurrent design", regenerate=True)
        return await asyncio.gather(research.execute_design(owner, request),
                                    research.execute_design(owner, request), return_exceptions=True)

    with TestClient(app) as client:
        try:
            client.get("/api/workspace")
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(
                    User.session_hash == session_hash(client.cookies.get(COOKIE_NAME)))).id
            results = asyncio.run(exercise(owner))
            assert sum(isinstance(item, dict) for item in results) == 1
            assert sum(isinstance(item, HTTPException) and item.status_code == 409 for item in results) == 1
            versions = client.get("/api/research/design/versions").json()
            assert len(versions) == 1 and versions[0]["number"] == 1
            assert client.get("/api/workspace").json()["design_version_id"] == versions[0]["artifact_id"]
        finally:
            clean(client)


def test_design_failure_rolls_back_workspace_and_artifact(monkeypatch):
    from app import research
    from app.models import DesignVersion
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    async def fake_run(_name, context):
        return research.quick_design(context["goal"], "")

    def fail_version_flush(session, _flush_context, _instances):
        if any(isinstance(item, DesignVersion) for item in session.new):
            raise RuntimeError("simulated version failure after artifact flush")

    monkeypatch.setattr(research, "run_task", fake_run)
    event.listen(Session, "before_flush", fail_version_flush)
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            try:
                before = client.get("/api/workspace").json()
                assert client.post("/api/research/design", json={"goal": "Atomic save test"}).status_code == 500
                after = client.get("/api/workspace").json()
                assert after["design_version_id"] == before["design_version_id"]
                assert after["design_idea"] == before["design_idea"]
                assert client.get("/api/research/artifacts", params={"kind": "experiment_design"}).json() == []
                assert client.get("/api/research/design/versions").json() == []
            finally:
                clean(client)
    finally:
        event.remove(Session, "before_flush", fail_version_flush)


def test_restore_design_from_different_idea_updates_workspace(monkeypatch):
    from app import research

    async def fake_run(_name, context):
        return research.quick_design(context["goal"], "")

    monkeypatch.setattr(research, "run_task", fake_run)
    with TestClient(app) as client:
        try:
            client.get("/api/session")
            with SessionLocal() as db:
                owner = db.scalar(select(User.id).where(User.session_hash == session_hash(client.cookies.get(COOKIE_NAME))))
            source = save_artifact(owner, "paper_compare", [], {})["id"]
            client.patch("/api/workspace", json={
                "design_idea": "Original idea", "research_gap": "Pinned evidence gap",
                "gap_context": {"synthesis_id": source, "question": "Original idea", "consensus": ["Evidence"]},
            })
            first = client.post("/api/research/design", json={"goal": "Original idea"}).json()
            before = client.get("/api/workspace").json()
            client.post("/api/research/design", json={"goal": "Different idea"})
            path = f"/api/research/design/versions/{first['version']['version_id']}/restore"
            latest = client.get("/api/workspace").json()
            assert client.post(path, json={"expected_updated_at": before["updated_at"]}).status_code == 409
            assert client.get("/api/workspace").json() == latest
            summaries = client.get("/api/research/design/history").json()["items"]
            assert [entry["goal"] for entry in summaries] == ["Different idea", "Original idea"]
            assert "payload" not in summaries[0]
            response = client.post(path, json={"expected_updated_at": latest["updated_at"]})
            assert response.status_code == 200
            workspace = client.get("/api/workspace").json()
            assert workspace["design_idea"] == "Original idea"
            assert workspace["design_version_id"] == first["id"]
            assert workspace["research_gap"] == "Pinned evidence gap"
            assert workspace["gap_context"]["synthesis_id"] == source
            assert workspace["gap_context"]["consensus"] == ["Evidence"]
        finally:
            clean(client)


def test_comparison_timeout_returns_promptly(monkeypatch, tmp_path):
    import asyncio

    async def slow_run(*_args, **_kwargs):
        await asyncio.sleep(0.1)

    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    monkeypatch.setattr("app.research.run_task", slow_run)
    monkeypatch.setattr("app.research.COMPARE_AI_TIMEOUT", 0.001)
    with TestClient(app) as client:
        try:
            ids = [client.post("/api/papers", files={"file":
                (f"{index}.pdf", pdf_bytes(f"Paper {index}"), "application/pdf")}).json()["id"]
                for index in (1, 2)]
            response = client.post("/api/research/compare", json={"paper_ids": ids})
            assert response.status_code == 504
            assert "等待上限" in response.json()["detail"]
        finally:
            clean(client)


def test_biological_research_templates():
    assert route_research("Clinical cell therapy")["template"] == "biomed_experiment"
    assert route_research("Randomized controlled trial of stroke care")["template"] == "clinical_study"
    assert route_research("Systematic review and meta-analysis of therapy")["template"] == "review_synthesis"
    assert route_research("Fuel cell materials")["domain"] == "general"
    assert route_research("Unknown topic")["domain"] == "general"
    assert route_research("Molecular pathways", field="Biology")["domain"] == "biomed"


def test_discovery_cache_refresh_and_offline_fallback(monkeypatch):
    from app.models import DiscoveryCache
    from uuid import uuid4

    calls = []
    async def fake_search(query, page, mode):
        calls.append((query, page, mode))
        if len(calls) == 3:
            raise DiscoveryRateLimited("quota")
        return {"items": [{"openalex_id": "W876543", "title": "Bridge engineering",
            "abstract": "", "field": "Engineering"}], "count": 1, "page": page, "mode": mode}

    monkeypatch.setattr("app.research.search_works", fake_search)
    with TestClient(app) as client:
        try:
            params = {"q": f"unique cache test bridge reliability {uuid4()}", "mode": "keyword"}
            first = client.get("/api/research/discover", params=params).json()
            second = client.get("/api/research/discover", params=params).json()
            assert len(calls) == 1 and not first["cached"] and second["cached"]
            assert first["fetched_at"] == second["fetched_at"]
            restored = client.get("/api/research/discover/cached", params=params).json()
            assert restored["cached"] and restored["items"][0]["title"] == "Bridge engineering"
            assert len(calls) == 1
            refreshed = client.get("/api/research/discover", params={**params, "refresh": True}).json()
            assert len(calls) == 2 and not refreshed["cached"]
            offline = client.get("/api/research/discover", params={**params, "refresh": True}).json()
            assert len(calls) == 3 and offline["cached"] and offline["stale"]
            assert client.get("/api/research/discover/cached", params={"q": f"uncached-{uuid4()}"}).status_code == 404
            assert len(calls) == 3
        finally:
            from app.research import cache_key
            with SessionLocal() as db:
                row = db.get(DiscoveryCache, cache_key("search", params["q"], "keyword", 1))
                if row:
                    db.delete(row)
                    db.commit()
            clean(client)


def test_metadata_is_not_fulltext_and_owner_isolation(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)

    async def fake_work(work_id):
        return {"openalex_id": work_id, "title": "Cell therapy study", "authors": ["A Researcher"],
                "year": 2025, "journal": "Journal", "doi": "", "abstract": "Study abstract only.",
                "citation_count": 4, "oa_pdf_url": None}

    monkeypatch.setattr("app.research.get_work", fake_work)
    with TestClient(app) as a, TestClient(app) as b:
        try:
            pa = a.post("/api/research/import", json={"openalex_id": "W123"}).json()
            pb = b.post("/api/research/import", json={"openalex_id": "W123"}).json()
            assert pa["id"] != pb["id"]
            assert pa["status"] == "metadata_only" and pa["full_text_available"] is False
            assert a.get(f"/api/papers/{pa['id']}/file").status_code == 422
            assert a.get(f"/api/papers/{pb['id']}").status_code == 404
            assert b.post(f"/api/papers/{pa['id']}/attach", files={"file": ("x.pdf", pdf_bytes("Cell therapy study"), "application/pdf")}).status_code == 404
            assert a.post("/api/research/compare", json={"paper_ids": [pa["id"], pb["id"]]}).status_code == 404
            response = a.post(f"/api/papers/{pa['id']}/attach", files={"file": ("x.pdf", pdf_bytes("Cell therapy study"), "application/pdf")})
            assert response.status_code == 200
            detail = a.get(f"/api/papers/{pa['id']}").json()
            assert detail["status"] == "parsed" and detail["full_text_available"] is True
            assert a.get(f"/api/papers/{pa['id']}/file").content.startswith(b"%PDF-")
            assert b.get(f"/api/papers/{pa['id']}/file").status_code == 404
            assert b.get("/api/research/artifacts").json() == []
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(User.session_hash == session_hash(a.cookies.get(COOKIE_NAME)))).id
            save_artifact(owner, "paper_summary", [pa["id"]], {"stages": []})
            assert len(a.get("/api/research/artifacts").json()) == 1
            a.delete(f"/api/papers/{pa['id']}")
            assert a.get("/api/research/artifacts").json() == []
        finally:
            clean(a)
            clean(b)


def test_structured_output_rejects_wrong_shapes():
    try:
        parse_json('{"papers":[],"dimensions":"not-a-list"}', Comparison)
    except StructuredAIError:
        pass
    else:
        raise AssertionError("Invalid structured response was accepted")


def test_openalex_metadata_and_remote_pdf_boundary():
    raw = {"id": "https://openalex.org/W123", "title": "Algorithm study", "publication_year": 2024,
           "abstract_inverted_index": {"A": [0], "result": [1]},
           "locations": [{"is_oa": True, "pdf_url": "https://example.org/random.pdf"},
                         {"is_oa": True, "pdf_url": "https://arxiv.org/pdf/1706.03762"}]}
    work = normalize_work(raw)
    assert work["abstract"] == "A result"
    assert work["oa_pdf_url"] == "https://arxiv.org/pdf/1706.03762"
    assert not public_https("http://127.0.0.1/internal.pdf")
    assert not public_https("https://localhost/private.pdf")


def test_discovery_uses_semantic_search_and_handles_public_budget(monkeypatch):
    import asyncio

    calls = []

    async def fake_get(path, params=None):
        calls.append((path, params))
        return {"meta": {"count": 1000}, "results": [
            {"id": "https://openalex.org/W1", "title": "Biology", "topics": [{"domain": {"id": "https://openalex.org/domains/1"}}]},
            {"id": "https://openalex.org/W2", "title": "Engineering", "topics": [{"domain": {"id": "https://openalex.org/domains/3"}}]},
            {"id": "https://openalex.org/W3", "title": "Health", "topics": [{"domain": {"id": "https://openalex.org/domains/4"}}]},
        ]}

    monkeypatch.setattr("app.services.openalex_service._get", fake_get)
    result = asyncio.run(search_works("How do cells respond to therapy?", 2, per_page=1))
    assert calls[-1] == ("/works", {"search.semantic": "How do cells respond to therapy?", "page": 1, "per_page": 50})
    assert result["count"] == 2
    assert [item["title"] for item in result["items"]] == ["Health"]
    asyncio.run(search_works("exact paper title", mode="keyword"))
    assert calls[-1][1]["search"] == "exact paper title"
    assert calls[-1][1]["filter"] == "topics.domain.id:1|4"

    async def no_budget(*_args, **_kwargs):
        raise DiscoveryRateLimited("quota")

    monkeypatch.setattr("app.research.search_works", no_budget)
    with TestClient(app) as client:
        try:
            response = client.get("/api/research/discover", params={"q": "biomed question"})
            assert response.status_code == 429
            assert "OpenAlex" in response.json()["detail"]
        finally:
            clean(client)


def test_workspace_persists_and_rejects_foreign_references(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as a, TestClient(app) as b:
        try:
            pa = a.post("/api/papers", files={"file": ("a.pdf", pdf_bytes("Engineering Study A"), "application/pdf")}).json()
            pb = b.post("/api/papers", files={"file": ("b.pdf", pdf_bytes("Engineering Study B"), "application/pdf")}).json()
            original = a.get("/api/workspace").json()
            assert original["selected_paper_ids"] == []
            changed = a.patch("/api/workspace", json={"query": "robotics reliability", "domain": "engineering",
                "selected_paper_ids": [pa["id"]], "core_paper_id": pa["id"]}).json()
            assert changed["workspace_id"] == original["workspace_id"]
            assert b.get("/api/workspace").json()["selected_paper_ids"] == []
            assert a.patch("/api/workspace", json={"selected_paper_ids": [pb["id"]]}).status_code == 404
            assert a.patch("/api/workspace", json={"core_paper_id": pb["id"]}).status_code == 404
            assert a.patch("/api/workspace", json={"synthesis_id": "unknown"}).status_code == 404
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(User.session_hash == session_hash(a.cookies.get(COOKIE_NAME)))).id
            save_artifact(owner, "novelty_analysis", [], {"query": "old idea"})
            assert a.get("/api/workspace").json()["novelty_id"] is not None
            changed_idea = a.patch("/api/workspace", json={"design_idea": "new idea"}).json()
            assert changed_idea["novelty_id"] is None
            with TestClient(app, cookies=dict(a.cookies)) as reopened:
                restored = reopened.get("/api/workspace").json()
                assert restored["query"] == "robotics reliability"
                assert restored["selected_paper_ids"] == [pa["id"]]
            a.delete(f"/api/papers/{pa['id']}")
            assert a.get("/api/workspace").json()["selected_paper_ids"] == []
            assert a.get("/api/workspace").json()["core_paper_id"] is None
        finally:
            clean(a)
            clean(b)


def test_design_versions_and_local_node_scope(monkeypatch):
    base = {"goal": "Design a reliable system", "change_summary": "初稿", "constraints": [],
            "nodes": [{"id": "N1", "label": "Question", "type": "question", "detail": "stable"},
                      {"id": "N2", "label": "Method", "type": "method", "detail": "baseline"},
                      {"id": "N3", "label": "Validation", "type": "validation", "detail": "baseline"}],
            "edges": [{"source": "N1", "target": "N2", "label": ""},
                      {"source": "N2", "target": "N3", "label": ""}],
            "controls": [], "readouts": [], "assumptions": []}

    contexts = []
    async def fake_run(_name, context):
        import copy
        contexts.append(context)
        result = copy.deepcopy(base)
        if context.get("node_id"):
            result["change_summary"] = "调整方法节点"
            result["nodes"][0]["detail"] = "should be ignored"
            result["nodes"][1]["detail"] = "lower cost"
        return result

    monkeypatch.setattr("app.research.run_task", fake_run)
    with TestClient(app) as a, TestClient(app) as b:
        try:
            a.patch("/api/workspace", json={"design_idea": "Design a reliable system",
                "research_gap": "Reliability under sparse data",
                "gap_context": {"consensus": ["Existing models are unstable"]}})
            first = a.post("/api/research/design", json={"goal": "Design a reliable system"}).json()
            assert first["version"]["number"] == 1
            assert contexts[0]["research_context"]["research_gap"] == "Reliability under sparse data"
            assert contexts[0]["research_context"]["synthesis_context"]["consensus"] == ["Existing models are unstable"]
            second = a.post("/api/research/design", json={"goal": "Design a reliable system", "action": "node",
                "node_id": "N2", "instruction": "lower cost", "current_design": first["payload"]}).json()
            assert second["version"]["number"] == 2
            assert second["payload"]["nodes"][0]["detail"] == "stable"
            assert second["payload"]["nodes"][1]["detail"] == "lower cost"
            versions = a.get("/api/research/design/versions").json()
            assert [item["number"] for item in versions] == [2, 1]
            assert versions[0]["changes"]["modified"] == ["Method"]
            assert b.post(f"/api/research/design/versions/{versions[0]['version_id']}/restore").status_code == 404
            restored = a.post(f"/api/research/design/versions/{versions[1]['version_id']}/restore").json()
            assert restored["number"] == 1
            assert a.get("/api/workspace").json()["design_version_id"] == first["id"]
            branch = a.post("/api/research/design", json={"goal": "Design a reliable system",
                "action": "cost", "current_design": restored["payload"]}).json()
            assert branch["version"]["number"] == 3
            assert branch["version"]["parent_version_id"] == restored["version_id"]
        finally:
            clean(a)
            clean(b)


def test_design_keeps_pinned_synthesis_after_working_selection_changes(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)

    async def fake_run(_name, context):
        return {"goal": context["goal"], "change_summary": "test", "constraints": [],
                "nodes": [], "edges": [], "controls": [], "readouts": [], "assumptions": []}

    monkeypatch.setattr("app.research.run_task", fake_run)
    with TestClient(app) as client:
        try:
            source_paper = client.post("/api/papers", files={"file": ("first.pdf", pdf_bytes("First source"))}).json()["id"]
            newer_paper = client.post("/api/papers", files={"file": ("next.pdf", pdf_bytes("Newer source"))}).json()["id"]
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(User.session_hash == session_hash(client.cookies.get(COOKIE_NAME)))).id
            source = save_artifact(owner, "paper_compare", [source_paper], {})
            newer = save_artifact(owner, "paper_compare", [newer_paper], {})
            goal = "How to preserve the source of a research question?"
            response = client.patch("/api/workspace", json={
                "design_idea": goal, "selected_paper_ids": [newer_paper], "research_gap": "The source gap",
                "gap_context": {"question": goal, "synthesis_id": source["id"]},
            })
            assert response.status_code == 200
            result = client.post("/api/research/design", json={"goal": goal})
            assert result.status_code == 200, result.text
            origin = result.json()["payload"]["research_origin"]
            assert origin["synthesis_id"] == source["id"]
            assert [item["paper_id"] for item in origin["selected_papers"]] == [source_paper]
            assert client.get("/api/workspace").json()["synthesis_id"] == newer["id"]
        finally:
            clean(client)


def test_background_result_cannot_overwrite_changed_workspace():
    import pytest
    from fastapi import HTTPException
    from app.workspace import job_workspace_context

    with TestClient(app) as client:
        try:
            client.patch("/api/workspace", json={"query": "original topic", "design_idea": "original idea"})
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(User.session_hash == session_hash(client.cookies.get(COOKIE_NAME)))).id
            comparison_context = job_workspace_context(owner, "compare")
            novelty_context = job_workspace_context(owner, "novelty")
            client.patch("/api/workspace", json={"query": "new topic", "design_idea": "new research idea"})
            with pytest.raises(HTTPException) as failed_comparison:
                save_artifact(owner, "paper_compare", [], {}, workspace_context=comparison_context)
            with pytest.raises(HTTPException) as failed_novelty:
                save_artifact(owner, "novelty_analysis", [], {"query": "old analysis"}, workspace_context=novelty_context)
            assert failed_comparison.value.status_code == failed_novelty.value.status_code == 409
            workspace = client.get("/api/workspace").json()
            assert workspace["design_idea"] == "new research idea"
            assert workspace["synthesis_id"] is workspace["novelty_id"] is None
            assert client.get("/api/research/artifacts").json() == []
        finally:
            clean(client)


def test_selection_merges_simultaneous_changes_and_rejects_old_topic(monkeypatch, tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from app import workspace

    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        try:
            client.patch("/api/workspace", json={"query": "Current research"})
            ids = []
            for index in range(6):
                reply = client.post("/api/papers", files={
                    "file": (f"paper-{index}.pdf", pdf_bytes(f"Evidence paper {index}")),
                })
                assert reply.status_code == 200, reply.text
                ids.append(reply.json()["id"])

            def set_selection(paper_id, selected=True, query="Current research"):
                return client.post("/api/workspace/selection", json={
                    "paper_id": paper_id, "selected": selected, "query": query,
                })

            write = workspace.workspace_for_write
            barrier = Barrier(2)

            def simultaneous_write(db, owner):
                barrier.wait(timeout=5)
                return write(db, owner)

            with monkeypatch.context() as concurrent:
                concurrent.setattr(workspace, "workspace_for_write", simultaneous_write)
                with ThreadPoolExecutor(max_workers=2) as executor:
                    responses = list(executor.map(set_selection, ids[:2]))
            assert [response.status_code for response in responses] == [200, 200]
            assert set(client.get("/api/workspace").json()["selected_paper_ids"]) == set(ids[:2])
            assert len(set_selection(ids[0]).json()["selected_paper_ids"]) == 2
            for paper_id in ids[2:5]:
                assert set_selection(paper_id).status_code == 200
            assert set_selection(ids[5]).status_code == 409
            assert set_selection(ids[0], False).status_code == 200
            assert set_selection(ids[0], False).status_code == 200
            assert set_selection(ids[5]).status_code == 200
            client.patch("/api/workspace", json={"query": "New topic", "selected_paper_ids": []})
            assert set_selection(ids[0]).status_code == 409
            assert client.get("/api/workspace").json()["selected_paper_ids"] == []

            with TestClient(app) as other:
                try:
                    foreign = other.post("/api/workspace/selection", json={
                        "paper_id": ids[0], "selected": True, "query": "",
                    })
                    assert foreign.status_code == 404
                finally:
                    clean(other)
        finally:
            clean(client)


def test_topic_change_checks_the_confirmed_workspace_and_preserves_saved_papers(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as client:
        try:
            paper = client.post("/api/papers", files={
                "file": ("topic.pdf", pdf_bytes("Topic evidence")),
            }).json()
            initial = client.patch("/api/workspace", json={
                "design_idea": "Prior design", "selected_paper_ids": [paper["id"]],
            }).json()

            def switch(query, snapshot):
                return client.post("/api/workspace/topic", json={
                    "query": query, "domain": "biomed", "study_type": "review",
                    "expected_updated_at": snapshot["updated_at"],
                })

            first = switch("  Active topic  ", initial).json()
            assert first["query"] == "Active topic"
            assert first["design_idea"] == initial["design_idea"]
            assert first["selected_paper_ids"] == [paper["id"]]
            same = switch("active TOPIC", first).json()
            assert same == first

            latest = client.patch("/api/workspace", json={
                "core_paper_id": paper["id"], "research_gap": "New evidence",
            }).json()
            assert switch("New topic", first).status_code == 409
            assert client.get("/api/workspace").json() == latest
            updated = switch("New topic", latest).json()
            assert updated["query"] == "New topic"
            assert updated["selected_paper_ids"] == [] and updated["core_paper_id"] is None
            assert updated["research_gap"] == "" and updated["design_idea"] == ""
            assert client.patch("/api/workspace", json={
                "core_paper_id": paper["id"], "expected_query": "Active topic",
            }).status_code == 409
            assert client.get(f"/api/papers/{paper['id']}").status_code == 200
        finally:
            clean(client)


def test_empty_comparison_claims_are_explicitly_insufficient(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    # A short X-Ray deadline must not cancel the separate multi-paper task.
    monkeypatch.setattr("app.research.FULLTEXT_AI_TIMEOUT", 0.001)

    async def fake_run(_name, context):
        import asyncio
        await asyncio.sleep(0.02)
        if _name == "evidence_extract":
            return {"claims": []}
        ids = [item["paper_id"] for item in context["papers"]]
        return {"papers": [{"paper_id": pid, "title": "paper", "domain": "biomed"} for pid in ids],
            "dimensions": [{"name": "研究问题", "values": [{"paper_id": pid, "value": "已提取", "source": "Title"} for pid in ids]}],
            "consensus": [], "differences": [], "controversies": [], "gaps": [],
            "questions": [], "next_steps": []}

    monkeypatch.setattr("app.research.run_task", fake_run)
    with TestClient(app) as client:
        try:
            ids = [client.post("/api/papers", files={"file":
                (f"{index}.pdf", pdf_bytes(f"Paper {index}"), "application/pdf")}).json()["id"]
                for index in (1, 2)]
            result = client.post("/api/research/compare", json={"paper_ids": ids})
            assert result.status_code == 200
            claim = result.json()["payload"]["controversies"][0]
            assert claim["stance"] == "INSUFFICIENT"
            assert claim["evidence_refs"] == []
        finally:
            clean(client)


def test_design_generation_pins_idea_and_keeps_novelty(monkeypatch):
    """设计生成时模型会用自己的话复述 goal。若不复述回用户原话，save_artifact 会把
    workspace.design_idea 改写成复述版，紧接着 GET /api/workspace 的
    prune_stale_idea_results 判定 novelty 的 query 与它不相等，就把 novelty_id 静默清空。"""
    import copy

    rewritten = {"goal": "模型改写过的研究目标", "change_summary": "初稿", "constraints": [],
                 "nodes": [{"id": "N1", "label": "Question", "type": "question", "detail": "d"}],
                 "edges": [], "controls": [], "readouts": [], "assumptions": []}

    async def fake_run(_name, _context):
        return copy.deepcopy(rewritten)

    monkeypatch.setattr("app.research.run_task", fake_run)
    with TestClient(app) as a:
        try:
            idea = "用更低成本的单细胞方法识别治疗前肿瘤耐药亚群"
            a.patch("/api/workspace", json={"design_idea": idea})
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(
                    User.session_hash == session_hash(a.cookies.get(COOKIE_NAME)))).id
            save_artifact(owner, "novelty_analysis", [], {"query": idea})
            assert a.get("/api/workspace").json()["novelty_id"] is not None
            created = a.post("/api/research/design", json={"goal": idea}).json()
            assert created["payload"]["goal"] == idea
            after = a.get("/api/workspace").json()
            assert after["design_idea"] == idea
            assert after["novelty_id"] is not None
        finally:
            clean(a)


def test_artifact_pointer_outside_list_window_stays_reachable():
    """工作区指针可能指向第 30 条之后的老 artifact。列表默认只回最近 30 条，前端按 id
    找不到就当成「结果丢了」——正是这次要堵的静默失效。artifact_id 必须能精确取到窗口外的记录，
    设计版本同理（默认 20 条）。"""
    with TestClient(app) as a:
        try:
            a.get("/api/workspace")  # 先落一次会话 cookie，否则拿不到 owner
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(
                    User.session_hash == session_hash(a.cookies.get(COOKIE_NAME)))).id
            oldest = save_artifact(owner, "novelty_analysis", [], {"query": "最早的扫描"})["id"]
            for index in range(30):
                save_artifact(owner, "novelty_analysis", [], {"query": f"后来的扫描 {index}"})
            listing = a.get("/api/research/artifacts?kind=novelty_analysis").json()
            assert len(listing) == 30
            assert oldest not in {item["id"] for item in listing}
            exact = a.get(f"/api/research/artifacts?kind=novelty_analysis&artifact_id={oldest}").json()
            assert [item["id"] for item in exact] == [oldest]
            assert exact[0]["payload"]["query"] == "最早的扫描"
        finally:
            clean(a)


def test_comparison_history_paginates_summaries_with_stable_order_and_owner_scope():
    import json
    from datetime import datetime, timezone
    from uuid import uuid4
    from app.models import ResearchArtifact

    with TestClient(app) as owner_client, TestClient(app) as other_client:
        try:
            owner_client.get("/api/session")
            other_client.get("/api/session")
            same_time = datetime(2026, 10, 1, tzinfo=timezone.utc)
            with SessionLocal() as db:
                owner = db.scalar(select(User.id).where(User.session_hash == session_hash(owner_client.cookies.get(COOKIE_NAME))))
                other = db.scalar(select(User.id).where(User.session_hash == session_hash(other_client.cookies.get(COOKIE_NAME))))
                records = [(str(uuid4()), owner, "paper_compare") for _ in range(13)]
                foreign_id = str(uuid4())
                for artifact_id, user_id, kind in [*records, (foreign_id, other, "paper_compare"), (str(uuid4()), owner, "experiment_design")]:
                    db.add(ResearchArtifact(
                        id=artifact_id, owner_id=user_id, kind=kind, created_at=same_time,
                        paper_ids_json=json.dumps(["paper-one", "paper-two"]),
                        payload_json=json.dumps({"papers": [{"title": "Saved paper"}], "consensus": ["Full result"]}),
                    ))
                db.commit()
            path = "/api/research/comparisons"
            first = owner_client.get(path).json()
            assert len(first["items"]) == 12
            assert first["items"][0].keys() == {"id", "created_at", "paper_count", "titles"}
            assert first["items"][0]["paper_count"] == 2 and first["items"][0]["titles"] == ["Saved paper"]
            second = owner_client.get(path, params={"before": first["next_before"]}).json()
            assert second["next_before"] is None
            assert [item["id"] for item in first["items"] + second["items"]] == sorted(
                (record[0] for record in records), reverse=True,
            )
            assert owner_client.get(path, params={"before": foreign_id}).status_code == 404
            assert [item["id"] for item in other_client.get(path).json()["items"]] == [foreign_id]
        finally:
            clean(owner_client)
            clean(other_client)


def test_comparison_views_only_return_requested_evidence_and_remain_owner_scoped():
    with TestClient(app) as client, TestClient(app) as visitor:
        try:
            client.get("/api/session")
            with SessionLocal() as db:
                owner = db.scalar(select(User.id).where(User.session_hash == session_hash(client.cookies.get(COOKIE_NAME))))
            claim = {"claim": "Evidence", "reason": "Observed", "paper_ids": ["paper"], "stance": "SUPPORTS",
                     "evidence_refs": [{"snippet": "Text available only in the evidence view"}]}
            artifact = save_artifact(owner, "paper_compare", ["paper"], {
                "papers": [{"paper_id": "paper", "title": "Paper"}],
                "dimensions": [{"name": "Dimension", "values": []}], "consensus": ["Agrees"],
                "controversies": [claim], "questions": ["Question"], "stale_after_reparse": True,
            })
            path = f"/api/research/comparisons/{artifact['id']}"
            matrix = client.get(path).json()["payload"]
            assert matrix["dimensions"] and matrix["consensus"] == ["Agrees"]
            assert matrix["controversies"] == matrix["questions"] == []
            evidence = client.get(path, params={"view": "evidence"}).json()["payload"]
            assert evidence["controversies"] == [claim] and evidence["dimensions"] == []
            gaps = client.get(path, params={"view": "gaps"}).json()["payload"]
            assert gaps["questions"] == ["Question"] and gaps["stale_after_reparse"] is True
            assert "evidence_refs" not in gaps["controversies"][0]
            assert visitor.get(path).status_code == 404
        finally:
            clean(client)
            clean(visitor)


def test_design_version_pointer_outside_list_window_stays_reachable():
    """当前工作区指向较早的设计版本时，前端仍能按 artifact_id 还原画布。"""
    import json
    from uuid import uuid4

    from app.models import DesignVersion, ResearchArtifact
    from app.workspace import get_or_create

    with TestClient(app) as client:
        try:
            client.get("/api/workspace")
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(
                    User.session_hash == session_hash(client.cookies.get(COOKIE_NAME)))).id
                workspace_id = get_or_create(db, owner).id
            artifact_ids = [str(uuid4()) for _ in range(205)]
            oldest_artifact = artifact_ids[0]
            with SessionLocal() as db:
                for number, artifact_id in enumerate(artifact_ids, 1):
                    goal = "　较早的研究问题　" if number == 1 else "同一研究问题"
                    db.add(ResearchArtifact(id=artifact_id, owner_id=owner, kind="experiment_design",
                        payload_json=json.dumps({"goal": goal, "number": number})))
                db.flush()
                for number, artifact_id in enumerate(artifact_ids, 1):
                    db.add(DesignVersion(id=str(uuid4()), owner_id=owner, workspace_id=workspace_id,
                        artifact_id=artifact_id, version_number=number, parent_version_id=None,
                        action="generate", changed_nodes_json=json.dumps({"added": [], "removed": [], "modified": []})))
                db.commit()
            recent = client.get("/api/research/design/versions").json()
            assert len(recent) == 20
            assert oldest_artifact not in {item["artifact_id"] for item in recent}
            exact = client.get(f"/api/research/design/versions?artifact_id={oldest_artifact}").json()
            assert len(exact) == 1
            assert exact[0]["artifact_id"] == oldest_artifact
            assert exact[0]["payload"]["number"] == 1
            summaries = client.get("/api/research/design/versions", params={"goal": "较早的研究问题", "summary": "true"}).json()
            assert [item["artifact_id"] for item in summaries] == [oldest_artifact]
            assert "payload" not in summaries[0] and "changes" not in summaries[0]
        finally:
            clean(client)


def test_structured_task_retries_transient_model_connection(monkeypatch):
    import asyncio
    import json
    import httpx
    from app.services.research_ai import run_task

    calls = 0
    async def flaky_completion(_messages):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ConnectError("temporary connection failure")
        yield json.dumps({"query": "test idea", "similar_papers": [],
            "similarity_level": "低", "differences": [], "novel_angles": []})

    monkeypatch.setattr("app.services.research_ai.stream_completion", flaky_completion)
    result = asyncio.run(run_task("novelty_analysis", {"query": "test idea", "papers": []}))
    assert calls == 2
    assert result["similarity_level"] == "低"


def test_design_uses_fast_structured_mode(monkeypatch):
    import asyncio
    import json
    from app.services.research_ai import run_task

    calls = []
    async def fake_completion(_messages, *, fast_structured=False):
        calls.append(fast_structured)
        yield json.dumps({"goal": "Test", "change_summary": "Draft", "constraints": [],
            "nodes": [{"id": "N1", "label": "Hypothesis", "type": "question"}],
            "edges": [], "controls": [], "readouts": []})

    monkeypatch.setattr("app.services.research_ai.stream_completion", fake_completion)
    result = asyncio.run(run_task("experiment_design", {"goal": "Test"}))
    assert calls == [True]
    assert result["nodes"][0]["id"] == "N1"


def test_comparison_requires_direct_result_refs_for_stance(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)

    async def fake_run(_name, context):
        first, second = context["papers"]
        result_unit = next(unit for unit in first["sections"] if unit["kind"] == "RESULTS")
        result_unit["page_end"] = result_unit["page"] + 1
        direct = {"paper_id": first["paper_id"], "unit_id": result_unit["unit_id"], "quote": "Treatment changed response."}
        invented = {**direct, "quote": "This invented sentence does not occur in the source."}
        ids = [first["paper_id"], second["paper_id"]]
        return {"papers": [{"paper_id": ids[0], "title": "Invented title", "domain": "biomed"}],
            "dimensions": [], "consensus": [], "differences": [], "gaps": [], "questions": [], "next_steps": [],
            "controversies": [
                {"claim": "第一篇报告了某项结果", "paper_ids": ids, "stance": "SUPPORTS",
                 "reason": "结果片段来自第一篇", "evidence_refs": [direct]},
                {"claim": "两篇结果相反", "paper_ids": ids, "stance": "REFUTES",
                 "reason": "尚无第二篇的结果片段", "evidence_refs": [direct]},
                {"claim": "虚构的结果", "paper_ids": ids, "stance": "SUPPORTS",
                 "reason": "无原文", "evidence_refs": [invented]},
            ]}

    monkeypatch.setattr("app.research.run_task", fake_run)
    with TestClient(app) as client:
        try:
            ids = [client.post("/api/papers", files={"file":
                (f"paper-{index}.pdf", pdf_bytes(f"Comparison Paper {index}"), "application/pdf")}).json()["id"]
                for index in (1, 2)]
            response = client.post("/api/research/compare", json={"paper_ids": ids})
            assert response.status_code == 200
            support, inconsistent, fabricated = response.json()["payload"]["controversies"]
            actual_papers = response.json()["payload"]["papers"]
            assert [paper["paper_id"] for paper in actual_papers] == ids
            assert [paper["title"] for paper in actual_papers] == ["Comparison Paper 1", "Comparison Paper 2"]
            assert support["stance"] == "SUPPORTS"
            assert len(support["evidence_refs"]) == 1
            assert support["evidence_refs"][0]["quote_verified"] is True
            assert support["evidence_refs"][0]["snippet"] == "Treatment changed response."
            assert support["evidence_refs"][0]["page"] is None
            assert support["evidence_refs"][0]["page_start"] == 1
            assert support["evidence_refs"][0]["page_end"] == 2
            assert support["evidence_refs"][0]["file_version"] == client.get(f"/api/papers/{ids[0]}").json()["file_version"]
            assert inconsistent["stance"] == "INSUFFICIENT"
            assert "不能列为结果不一致" in inconsistent["reason"]
            assert fabricated["stance"] == "INSUFFICIENT"
            assert fabricated["evidence_refs"][0]["quote_verified"] is False
        finally:
            clean(client)


def test_empty_evidence_map_recovers_only_verifiable_single_study_results(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)

    async def fake_run(name, context):
        if name == "paper_compare":
            return {"papers": [], "dimensions": [], "consensus": [], "differences": [],
                "gaps": [], "questions": [], "next_steps": [], "controversies": []}
        assert name == "evidence_extract"
        assert context["candidates"][0]["id"] == "E1"
        candidate = {"claim": "该研究报告了处理后的变化", "candidate_id": "E1", "reason": "限于本研究。"}
        return {"claims": [candidate, {**candidate, "candidate_id": "E999"}]}

    monkeypatch.setattr("app.research.run_task", fake_run)
    with TestClient(app) as client:
        try:
            ids = [client.post("/api/papers", files={"file":
                (f"paper-{index}.pdf", pdf_bytes(f"Comparison Paper {index}"), "application/pdf")}).json()["id"]
                for index in (1, 2)]
            from app.models import ReadingUnit
            with SessionLocal() as db:
                for unit in db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id.in_(ids), ReadingUnit.kind == "RESULTS")):
                    unit.source_text = "Treatment changed the measured response in comparison with the control group."
                db.commit()
            response = client.post("/api/research/compare", json={"paper_ids": ids})
            assert response.status_code == 200
            claims = response.json()["payload"]["controversies"]
            assert len(claims) == 1
            assert claims[0]["stance"] == "INSUFFICIENT"
            assert claims[0]["paper_ids"] == ids[:1]
            assert "不能据此判断跨论文一致性" in claims[0]["reason"]
            assert "尚未独立核验" in claims[0]["reason"]
            assert claims[0]["evidence_refs"][0]["quote_verified"] is True
        finally:
            clean(client)


def test_optional_evidence_extraction_timeout_keeps_comparison(monkeypatch, tmp_path):
    import asyncio
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    monkeypatch.setattr("app.research.EVIDENCE_EXTRACTION_TIMEOUT", 0.001)

    async def fake_run(name, context):
        if name == "evidence_extract":
            await asyncio.sleep(0.1)
        return {"papers": [], "dimensions": [], "consensus": [], "differences": [],
            "gaps": [], "questions": [], "next_steps": [], "controversies": []}

    monkeypatch.setattr("app.research.run_task", fake_run)
    with TestClient(app) as client:
        try:
            ids = [client.post("/api/papers", files={"file":
                (f"paper-{index}.pdf", pdf_bytes(f"Comparison Paper {index}"), "application/pdf")}).json()["id"]
                for index in (1, 2)]
            from app.models import ReadingUnit
            with SessionLocal() as db:
                for unit in db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id.in_(ids), ReadingUnit.kind == "RESULTS")):
                    unit.source_text = "Treatment changed the measured response in comparison with the control group."
                db.commit()
            response = client.post("/api/research/compare", json={"paper_ids": ids})
            assert response.status_code == 200
            assert response.json()["payload"]["controversies"][0]["stance"] == "INSUFFICIENT"
        finally:
            clean(client)


def test_evidence_extraction_skips_midword_fragments_and_panel_captions(monkeypatch, tmp_path):
    from app.models import ReadingUnit
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    calls = []

    async def fake_run(name, _context):
        calls.append(name)
        if name == "evidence_extract":
            return {"claims": []}
        return {"papers": [], "dimensions": [], "consensus": [], "differences": [],
            "gaps": [], "questions": [], "next_steps": [], "controversies": []}

    monkeypatch.setattr("app.research.run_task", fake_run)
    with TestClient(app) as client:
        try:
            ids = [client.post("/api/papers", files={"file":
                (f"paper-{i}.pdf", pdf_bytes(f"Comparison Paper {i}"), "application/pdf")}).json()["id"]
                for i in (1, 2)]
            with SessionLocal() as db:
                for unit in db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id.in_(ids), ReadingUnit.kind == "RESULTS")):
                    unit.source_text = ("ragment that starts halfway through an original sentence and should be skipped. "
                        "B, C The protein expression was detected in treated cells for screening purposes. "
                        "In these mice the treatment showed a measurable effect, but the population is unclear. "
                        "The pathway was significantly affected according to the experiment in Fig.")
                db.commit()
            response = client.post("/api/research/compare", json={"paper_ids": ids})
            assert response.status_code == 200
            assert calls == ["paper_compare"]
            assert response.json()["payload"]["controversies"][0]["stance"] == "INSUFFICIENT"
        finally:
            clean(client)
