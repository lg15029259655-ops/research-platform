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


def test_cross_domain_templates():
    samples = [("Neural network algorithm benchmark", "cs_algorithm"),
               ("Perovskite material stability", "material_experiment"),
               ("Robotics engineering design", "engineering_design"),
               ("Education policy regression analysis", "social_statistics"),
               ("Clinical cell therapy", "biomed_experiment")]
    for title, expected in samples:
        assert route_research(title)["template"] == expected
    assert route_research("Unknown topic")["template"] == "general_research"
    for title, expected in [
        ("Randomized controlled trial of stroke care", "clinical_study"),
        ("Finite element simulation of a bridge", "simulation_validation"),
        ("A proof of the main theorem", "theory_proof"),
        ("Systematic review and meta-analysis of therapy", "review_synthesis"),
    ]:
        assert route_research(title)["template"] == expected


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
        return {"meta": {"count": 1000}, "results": []}

    monkeypatch.setattr("app.services.openalex_service._get", fake_get)
    result = asyncio.run(search_works("How do cells respond to therapy?", 2))
    assert calls[-1] == ("/works", {"search.semantic": "How do cells respond to therapy?", "page": 2, "per_page": 10})
    assert result["count"] == 50
    asyncio.run(search_works("exact paper title", mode="keyword"))
    assert calls[-1][1]["search"] == "exact paper title"

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


def test_empty_comparison_claims_are_explicitly_insufficient(monkeypatch, tmp_path):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)

    async def fake_run(_name, context):
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


def test_design_version_pointer_outside_list_window_stays_reachable():
    """当前工作区指向较早的设计版本时，前端仍能按 artifact_id 还原画布。"""
    import json
    from uuid import uuid4

    from app.models import DesignVersion
    from app.workspace import get_or_create

    with TestClient(app) as client:
        try:
            client.get("/api/workspace")
            with SessionLocal() as db:
                owner = db.scalar(select(User).where(
                    User.session_hash == session_hash(client.cookies.get(COOKIE_NAME)))).id
                workspace_id = get_or_create(db, owner).id
            oldest_artifact = ""
            for number in range(1, 22):
                artifact = save_artifact(owner, "experiment_design", [], {"goal": "同一研究问题", "number": number})
                if number == 1:
                    oldest_artifact = artifact["id"]
                with SessionLocal() as db:
                    db.add(DesignVersion(id=str(uuid4()), owner_id=owner, workspace_id=workspace_id,
                        artifact_id=artifact["id"], version_number=number, parent_version_id=None,
                        action="generate", changed_nodes_json=json.dumps({"added": [], "removed": [], "modified": []})))
                    db.commit()
            recent = client.get("/api/research/design/versions").json()
            assert len(recent) == 20
            assert oldest_artifact not in {item["artifact_id"] for item in recent}
            exact = client.get(f"/api/research/design/versions?artifact_id={oldest_artifact}").json()
            assert len(exact) == 1
            assert exact[0]["artifact_id"] == oldest_artifact
            assert exact[0]["payload"]["number"] == 1
        finally:
            clean(client)
