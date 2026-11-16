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
        if index:
            assert item["depends_on"] == [experiments[index - 1]["id"]]


def test_ai_result_is_validated(client, monkeypatch):
    paper_id, unit_ids = _upload(client, "AI validation paper")

    async def fake_ai(name, context, **_kwargs):
        assert name == "paper_experiments_extract"
        return {
            "summary": "AI 提取的实验链",
            "experiments": [
                {"id": "X1", "order": 1, "title": "细胞培养与转染", "category": "cell_experiment",
                 "methods": ["siRNA 转染"], "result": "敲低后增殖下降",
                 "evidence": [{"unit_id": unit_ids[0], "page": 1, "snippet": "siRNA"}],
                 "depends_on": [], "inferred": False},
                {"id": "X2", "order": 2, "title": "非法分类实验", "category": "not-a-category",
                 "methods": [], "result": "", "evidence": [], "depends_on": [], "inferred": True},
                {"id": "X3", "order": 3, "title": "动物模型构建", "category": "animal_experiment",
                 "methods": ["裸鼠成瘤"], "result": "肿瘤生长受抑制",
                 "evidence": [{"unit_id": "bogus-unit", "page": 9, "snippet": "假引用"}],
                 "depends_on": ["X1"], "inferred": False},
            ],
        }

    monkeypatch.setattr("app.services.research_ai.run_task_events", fake_ai)
    job = client.post("/api/jobs", json={"kind": "paper_experiments", "params": {"paper_id": paper_id}}).json()
    snapshot = _wait(client, job["id"])
    assert snapshot["status"] == "done"
    payload = snapshot["result"]["payload"]
    assert payload["generated_by"] == "ai"
    titles = [item["title"] for item in payload["experiments"]]
    assert titles == ["细胞培养与转染", "动物模型构建"]  # 非法分类被丢弃
    assert payload["experiments"][1]["evidence"] == []  # 假 unit 被丢弃
    assert payload["experiments"][1]["inferred"] is True
    assert payload["experiments"][1]["depends_on"] == ["E1"]


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


def test_generic_fallback_when_no_lab_experiments():
    """没有可识别实验的论文也要给出可核对的三阶段，而不是空图。"""
    from app.models import ReadingUnit

    units = [
        ReadingUnit(id="p:0", paper_id="p", position=0, kind="METHODS", heading="Methods",
                    page_start=1, page_end=1, source_text="We describe the evaluation protocol."),
        ReadingUnit(id="p:1", paper_id="p", position=1, kind="RESULTS", heading="Results",
                    page_start=2, page_end=2, source_text="Scores improved slightly."),
    ]
    experiments = paper_experiment_service.rules_experiments(units)
    if len(experiments) < 2:
        experiments = paper_experiment_service.generic_experiments(units)
    assert len(experiments) == 3
    assert all(item["inferred"] for item in experiments)
    assert experiments[0]["evidence"][0]["unit_id"] == "p:0"
