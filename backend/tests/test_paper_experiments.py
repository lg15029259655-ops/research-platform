"""论文实验导图：规则提取、AI 校验、缓存、任务端点。"""

import time

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import paper_experiment_service

VALID_CATEGORIES = {
    "data_analysis", "cell_experiment", "animal_experiment", "molecular_experiment",
    "clinical_sample", "imaging", "materials_prep", "engineering_test",
    "modeling_algorithm", "survey_statistics", "result_conclusion",
}


def make_pdf(title: str = "KIF11 Study") -> bytes:
    document = pymupdf.open()
    page = document.new_page()
    lines = (
        title,
        "Abstract",
        "KIF11 is overexpressed in hepatocellular carcinoma.",
        "Methods",
        "Cell culture and transfection: HepG2 cells were transfected with siRNA.",
        "Western blot and qPCR: Protein and mRNA levels were detected.",
        "Animal experiment: nude mice received subcutaneous xenografts and dosing.",
        "Results",
        "KIF11 knockdown reduced proliferation and induced apoptosis.",
        "Figure 1. Xenograft tumor growth was suppressed in nude mice.",
        "Discussion",
        "Results are limited to two cell lines.",
        "Conclusion",
        "KIF11 inhibition is a candidate strategy.",
    )
    for index, line in enumerate(lines):
        page.insert_text((50, 50 + index * 30), line, fontsize=11)
    data = document.tobytes()
    document.close()
    return data


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as test_client:
        yield test_client


def _wait(client, job_id, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        snapshot = client.get(f"/api/jobs/{job_id}").json()
        if snapshot["status"] in ("done", "failed", "canceled"):
            return snapshot
        time.sleep(0.05)
    raise AssertionError("job timeout")


def _upload(client, title="KIF11 Study") -> tuple[str, list[str]]:
    paper = client.post("/api/papers", files={"file": ("bio.pdf", make_pdf(title), "application/pdf")}).json()
    detail = client.get(f"/api/papers/{paper['id']}").json()
    return paper["id"], [unit["id"] for unit in detail["units"]]


def test_rules_extraction_builds_evidence_chain(client, monkeypatch):
    paper_id, unit_ids = _upload(client)

    async def broken(*_args, **_kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr("app.services.research_ai.run_task_events", broken)
    job = client.post("/api/jobs", json={"kind": "paper_experiments", "params": {"paper_id": paper_id}}).json()
    snapshot = _wait(client, job["id"])
    assert snapshot["status"] == "done", snapshot
    payload = snapshot["result"]["payload"]
    assert payload["generated_by"] == "rules"
    experiments = payload["experiments"]
    assert len(experiments) >= 2
    valid_ids = set(unit_ids)
    for index, item in enumerate(experiments):
        assert item["order"] == index + 1
        assert item["category"] in VALID_CATEGORIES
        assert item["evidence"], "每个实验至少应挂一条证据（或标记推断）"
        for ref in item["evidence"]:
            assert ref["unit_id"] in valid_ids
        assert item["depends_on"] == []
        assert item["inferred"] is True


def test_ai_result_is_validated(client, monkeypatch):
    paper_id, unit_ids = _upload(client, "AI validation paper")

    async def fake_ai(name, context, **_kwargs):
        assert name == "paper_experiments_extract"
        source = next(item for item in context["units"] if len(item["text"]) >= 12)
        return {
            "summary": "AI 提取的实验链",
            "experiments": [
                {"id": "X1", "order": 1, "title": "细胞培养与转染", "category": "cell_experiment",
                 "methods": ["siRNA 转染"], "result": "敲低后增殖下降",
                 "evidence": [{"unit_id": source["unit_id"], "page": 1, "snippet": source["text"][:30]}],
                 "depends_on": [], "inferred": False},
                {"id": "X2", "order": 2, "title": "非法分类实验", "category": "not-a-category",
                 "methods": [], "result": "", "evidence": [], "depends_on": [], "inferred": True},
                {"id": "X3", "order": 3, "title": "动物模型构建", "category": "animal_experiment",
                 "methods": ["裸鼠成瘤"], "result": "肿瘤生长受抑制",
                 "evidence": [{"unit_id": source["unit_id"], "page": 9, "snippet": "This quotation was never in the paper."}],
                 "depends_on": ["X1"], "inferred": False},
            ],
        }

    monkeypatch.setattr("app.services.research_ai.run_task_events", fake_ai)
    job = client.post("/api/jobs", json={"kind": "paper_experiments", "params": {"paper_id": paper_id}}).json()
    snapshot = _wait(client, job["id"])
    assert snapshot["status"] == "done"
    payload = snapshot["result"]["payload"]
    assert payload["generated_by"] == "ai_and_rules"
    titles = [item["title"] for item in payload["experiments"]]
    assert "细胞培养与转染" in titles
    assert "非法分类实验" not in titles
    assert all("never in the paper" not in ref["snippet"] for item in payload["experiments"] for ref in item["evidence"])
    assert payload["experiments"][0]["inferred"] is True
    assert payload["experiments"][0]["depends_on"] == []


def test_cached_result_is_reused(client, monkeypatch):
    paper_id, _ = _upload(client, "Cache paper")
    calls = {"n": 0}

    async def broken(*_args, **_kwargs):
        calls["n"] += 1
        raise RuntimeError("no ai")

    monkeypatch.setattr("app.services.research_ai.run_task_events", broken)
    first = _wait(client, client.post("/api/jobs", json={"kind": "paper_experiments", "params": {"paper_id": paper_id}}).json()["id"])
    second = _wait(client, client.post("/api/jobs", json={"kind": "paper_experiments", "params": {"paper_id": paper_id}}).json()["id"])
    assert first["result"]["id"] == second["result"]["id"]
    assert calls["n"] == 1  # 第二次命中缓存，不再调用模型


def test_missing_paper_id_and_metadata_paper(client):
    job = client.post("/api/jobs", json={"kind": "paper_experiments", "params": {}}).json()
    snapshot = _wait(client, job["id"])
    assert snapshot["status"] == "failed" and snapshot["error"]["code"] == "invalid_params"

    job = client.post("/api/jobs", json={"kind": "paper_experiments", "params": {"paper_id": "missing"}}).json()
    snapshot = _wait(client, job["id"])
    assert snapshot["status"] == "failed" and snapshot["error"]["code"] in ("not_found", "invalid_state")


def test_unmatched_results_do_not_create_or_attach_experiments():
    from app.models import ReadingUnit
    units = [
        ReadingUnit(id="p:0", paper_id="p", position=0, kind="METHODS", heading="Methods", page_start=1, page_end=1, source_text="Cell culture was performed."),
        ReadingUnit(id="p:1", paper_id="p", position=1, kind="RESULTS", heading="Results", page_start=2, page_end=2, source_text="A completely unrelated result occurred."),
    ]
    experiments = paper_experiment_service.rules_experiments(units)
    assert len(experiments) == 1
    assert experiments[0]["result"] == ""
    assert all(ref["unit_id"] != "p:1" for ref in experiments[0]["evidence"])
    assert experiments[0]["depends_on"] == []


def test_short_keywords_do_not_match_inside_unrelated_words():
    assert paper_experiment_service._match("We used a separate approach.") is None
    assert paper_experiment_service._match("Rats were studied.")[1] == "动物模型构建"
    assert paper_experiment_service._match("The rat model was examined.")[1] == "动物模型构建"


def test_context_includes_later_methods_and_method_only_has_no_result():
    from app.models import Paper, ReadingUnit
    unit = ReadingUnit(id="long", paper_id="p", position=0, kind="METHODS", heading="Methods", page_start=3, page_end=5, source_text=("Background material " * 120) + "Western blot analysis was performed.")
    context = paper_experiment_service._ai_context(Paper(title="Study"), [unit])
    assert any("Western blot" in chunk["text"] for chunk in context["units"])
    candidates = paper_experiment_service.rules_experiments([unit])
    assert any(item["title"] == "Western blot" for item in candidates)
    payload = {"experiments": [{"title": "Western blot", "category": "molecular_experiment", "result": "Imagined effect", "evidence": [{"unit_id": "long", "snippet": "Western blot analysis was performed."}]}]}
    assert paper_experiment_service._validate_ai(payload, [unit])[0]["result"] == ""
