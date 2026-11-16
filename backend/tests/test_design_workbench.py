import asyncio

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import research
from app.auth import COOKIE_NAME, session_hash
from app.db import SessionLocal
from app.main import app
from app.models import User
from sqlalchemy import select


def owner_of(client):
    with SessionLocal() as db:
        return db.scalar(select(User.id).where(User.session_hash == session_hash(client.cookies[COOKIE_NAME])))


def test_manual_edit_creates_version_and_checks_owner_and_staleness(monkeypatch):
    async def fake_run(_name, context):
        return research.quick_design(context["goal"], "")
    monkeypatch.setattr(research, "run_task", fake_run)
    with TestClient(app) as a, TestClient(app) as b:
        a.patch("/api/workspace", json={"design_idea": "Investigate study design", "research_gap": "Gap from comparison"})
        first = a.post("/api/research/design", json={"goal": "Investigate study design"}).json()
        assert first["payload"]["research_origin"]["research_gap"] == "Gap from comparison"
        b.get("/api/session")
        draft = dict(first["payload"])
        draft["nodes"] = [*draft["nodes"], {"id": "manual-1", "label": "User experiment", "type": "method", "detail": "Confirm controls"}]
        draft["nodes"][0] = {**draft["nodes"][0], "steps": [{"name": "Specific analysis", "purpose": "Check hypothesis", "method": "Compare groups", "controls": "Control group", "readouts": "Outcome"}]}
        request = {"artifact_id": first["id"], "design": draft}
        assert b.post("/api/research/design/manual", json=request).status_code == 404
        saved = a.post("/api/research/design/manual", json=request)
        assert saved.status_code == 200
        result = saved.json()
        assert result["version"]["number"] == 2
        assert result["version"]["parent_version_id"] == first["version"]["version_id"]
        assert result["payload"]["research_origin"]["research_gap"] == "Gap from comparison"
        assert any(node["label"] == "User experiment" for node in result["payload"]["nodes"])
        assert result["payload"]["nodes"][0]["steps"][0]["name"] == "Specific analysis"
        assert a.get("/api/workspace").json()["design_version_id"] == result["id"]
        assert a.post("/api/research/design/manual", json=request).status_code == 409
        assert a.post(f"/api/research/design/versions/{first['version']['version_id']}/restore").status_code == 200


def test_design_insights_reject_wrong_owner_node_and_changed_version(monkeypatch):
    async def fake_generate(_name, context):
        return research.quick_design(context["goal"], "")
    monkeypatch.setattr(research, "run_task", fake_generate)
    with TestClient(app) as a, TestClient(app) as b:
        first = a.post("/api/research/design", json={"goal": "Review study design"}).json()
        b.get("/api/session")
        owner, other = owner_of(a), owner_of(b)
        with pytest.raises(HTTPException) as denied:
            asyncio.run(research.execute_design_insight(other, first["id"], "design_review"))
        assert denied.value.status_code == 404
        with pytest.raises(HTTPException) as missing:
            asyncio.run(research.execute_design_insight(owner, first["id"], "design_outcomes", "missing"))
        assert missing.value.status_code == 422

        async def stale(_name, _context, emit=None, **_kwargs):
            draft = dict(first["payload"])
            response = a.post("/api/research/design/manual", json={"artifact_id": first["id"], "design": draft})
            assert response.status_code == 200
            return {"issues": [], "limitations": []}
        monkeypatch.setattr(research, "_run_task", stale)
        with pytest.raises(HTTPException) as changed:
            asyncio.run(research.execute_design_insight(owner, first["id"], "design_review"))
        assert changed.value.status_code == 409


def test_design_insights_return_review_and_outcomes_for_current_version(monkeypatch):
    async def fake_generate(_name, context):
        return research.quick_design(context["goal"], "")
    monkeypatch.setattr(research, "run_task", fake_generate)
    with TestClient(app) as client:
        design = client.post("/api/research/design", json={"goal": "Evaluate design logic"}).json()
        owner = owner_of(client)
        node_id = design["payload"]["nodes"][0]["id"]

        async def fake_insight(name, context, emit=None, **_kwargs):
            assert context["design"]["goal"] == "Evaluate design logic"
            if name == "design_review":
                return {"issues": [{"title": "Check control", "reason": "Not specified", "suggestion": "Verify", "node_id": "invented"}], "limitations": []}
            assert context["node_id"] == node_id
            return {"branches": [{"scenario": "Not supported", "interpretation": "Multiple explanations", "next_step": "Check controls"}], "limitations": ["Hypothetical"]}
        monkeypatch.setattr(research, "_run_task", fake_insight)
        review = asyncio.run(research.execute_design_insight(owner, design["id"], "design_review"))
        assert review["issues"][0]["node_id"] == ""
        outcomes = asyncio.run(research.execute_design_insight(owner, design["id"], "design_outcomes", node_id))
        assert outcomes["node_id"] == node_id and outcomes["branches"][0]["next_step"] == "Check controls"


def test_design_schema_accepts_old_versions_and_structured_experiments():
    from app.services.research_ai import Design
    old = research.quick_design("Example study", "")
    for node in old["nodes"]:
        node.pop("steps", None)
    assert all(node.steps == [] for node in Design.model_validate(old).nodes)
    old["nodes"][0]["steps"] = [{"name": "Public database analysis", "purpose": "Identify candidates",
        "method": "Compare available groups", "controls": "To be determined", "readouts": "Expression"}]
    assert Design.model_validate(old).nodes[0].steps[0].name == "Public database analysis"


def test_manual_icon_category_survives_versions_and_restore(monkeypatch):
    async def fake_generate(_name, context):
        return research.quick_design(context["goal"], "")
    monkeypatch.setattr(research, "run_task", fake_generate)
    with TestClient(app) as client:
        first = client.post("/api/research/design", json={"goal": "Inspect category persistence"}).json()
        draft = first["payload"]
        draft["nodes"][0]["steps"] = [{"name": "Mixed research method", "icon_category": "interview"}]
        response = client.post("/api/research/design/manual", json={"artifact_id": first["id"], "design": draft})
        assert response.status_code == 200
        saved = response.json()
        assert saved["payload"]["nodes"][0]["steps"][0]["icon_category"] == "interview"
        assert client.post(f"/api/research/design/versions/{first['version']['version_id']}/restore").status_code == 200
        restored = client.post(f"/api/research/design/versions/{saved['version']['version_id']}/restore")
        assert restored.status_code == 200
        assert restored.json()["payload"]["nodes"][0]["steps"][0]["icon_category"] == "interview"


def test_ai_revision_preserves_only_unambiguous_user_illustrations():
    before = {"nodes": [{"id": "n1", "steps": [
        {"name": "Shared step", "icon_category": "clinical"},
        {"name": "Ambiguous", "icon_category": "gene"},
        {"name": "Ambiguous", "icon_category": "cell"},
    ]}]}
    after = {"nodes": [{"id": "n1", "steps": [
        {"name": "Shared step", "icon_category": None}, {"name": "Ambiguous", "icon_category": None},
        {"name": "New step", "icon_category": None},
    ]}, {"id": "n2", "steps": [{"name": "Shared step", "icon_category": None}]}]}
    research.preserve_step_illustrations(before, after)
    assert after["nodes"][0]["steps"][0]["icon_category"] == "clinical"
    assert after["nodes"][0]["steps"][1]["icon_category"] is None
    assert after["nodes"][0]["steps"][2]["icon_category"] is None
    assert after["nodes"][1]["steps"][0]["icon_category"] is None


def test_ai_adjustment_keeps_saved_illustration_when_model_omits_it(monkeypatch):
    async def fake_run(_name, context):
        if not context.get("current_design"):
            return research.quick_design(context["goal"], "")
        import copy
        result = copy.deepcopy(context["current_design"])
        result["nodes"][0]["steps"][0].pop("icon_category", None)
        return result
    monkeypatch.setattr(research, "run_task", fake_run)
    with TestClient(app) as client:
        first = client.post("/api/research/design", json={"goal": "Evaluate an education design"}).json()
        draft = first["payload"]
        draft["nodes"][0]["steps"] = [{"name": "Follow-up study", "icon_category": "education"}]
        saved = client.post("/api/research/design/manual", json={"artifact_id": first["id"], "design": draft}).json()
        revised = client.post("/api/research/design", json={"goal": draft["goal"], "action": "causality", "current_design": saved["payload"]})
        assert revised.status_code == 200
        assert revised.json()["payload"]["nodes"][0]["steps"][0]["icon_category"] == "education"
