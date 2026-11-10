"""思维导图测试：确定性骨架、标注校验、缓存、AI 失败回退。"""

import time

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import Paper, ReadingUnit
from app.services import mindmap_service


def make_pdf(title: str) -> bytes:
    document = pymupdf.open()
    page = document.new_page()
    lines = (title, "Abstract", "We study threshold tuning.", "Methods", "We compare detectors.",
             "Results", "Threshold choice changes ranking.", "Figure 1. Ranking by threshold.",
             "Discussion", "Results are limited to three datasets.", "Conclusion", "Procedure, not metric.")
    for index, line in enumerate(lines):
        page.insert_text((50, 50 + index * 35), line, fontsize=12)
    data = document.tobytes()
    document.close()
    return data


def unit(unit_id: str, kind: str, heading: str, page: int = 1) -> ReadingUnit:
    return ReadingUnit(id=unit_id, paper_id="p1", position=0, kind=kind, heading=heading,
                       page_start=page, page_end=page, source_text="text")


def fake_paper(title: str = "Threshold paper") -> Paper:
    return Paper(id="p1", owner_id="u1", title=title, original_filename="p.pdf",
                 stored_filename="p.pdf", local_file_path="/tmp/p.pdf", mime_type="application/pdf",
                 file_size_bytes=1, sha256="abc123", status="parsed")


def test_skeleton_is_deterministic_and_ordered():
    paper = fake_paper()
    units = [unit("p1:0", "ABSTRACT", "Abstract"), unit("p1:1", "METHODS", "Methods"),
             unit("p1:2", "RESULTS", "Results"), unit("p1:3", "FIGURE", "Figure 1"),
             unit("p1:4", "DISCUSSION", "Discussion"), unit("p1:5", "CONCLUSION", "Conclusion")]
    first = mindmap_service.build_skeleton(paper, units)
    second = mindmap_service.build_skeleton(paper, units)
    assert first == second
    assert first["id"] == "root"
    headings = [child["label"] for child in first["children"]]
    assert headings[:3] == ["摘要", "方法", "结果"]
    results = next(child for child in first["children"] if child["id"] == "sec:results")
    assert any(node["id"].startswith("fig:") for node in results["children"])


def test_annotations_reject_unknown_nodes_and_units():
    paper = fake_paper()
    units = [unit("p1:0", "ABSTRACT", "Abstract"), unit("p1:1", "RESULTS", "Results")]
    tree = mindmap_service.build_skeleton(paper, units)
    tree = mindmap_service.apply_annotations(
        tree,
        [
            {"node_id": "sec:abstract", "label": "阈值指标被拆成三部分", "kind": "question",
             "unit_ids": ["p1:0", "does-not-exist"]},
            {"node_id": "ghost-node", "label": "不存在的节点", "kind": "finding", "unit_ids": ["p1:0"]},
            {"node_id": "sec:results", "label": "排名被阈值左右", "kind": "not-a-kind", "unit_ids": ["p1:1"]},
        ],
        {"p1:0", "p1:1"},
    )
    nodes = {node["id"]: node for node in mindmap_service._flatten(tree)}
    assert nodes["sec:abstract"]["label"] == "阈值指标被拆成三部分"
    assert nodes["sec:abstract"]["unit_ids"] == ["p1:0"]
    assert nodes["sec:results"]["label"] == "排名被阈值左右"
    assert nodes["sec:results"]["kind"] == "finding"  # 非法 kind 不覆盖，保留骨架类型
    assert "ghost-node" not in nodes


def test_parse_revision_changes_with_structure():
    paper = fake_paper()
    base = [unit("p1:0", "ABSTRACT", "Abstract")]
    assert mindmap_service.parse_revision(paper, base) == mindmap_service.parse_revision(paper, base)
    longer = base + [unit("p1:1", "METHODS", "Methods")]
    assert mindmap_service.parse_revision(paper, base) != mindmap_service.parse_revision(paper, longer)


def _wait(client, job_id: str, timeout: float = 6.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        snapshot = client.get(f"/api/jobs/{job_id}").json()
        if snapshot["status"] in ("done", "failed", "canceled"):
            return snapshot
        time.sleep(0.02)
    raise AssertionError("mindmap job did not finish")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.file_service.upload_dir", lambda: tmp_path)
    with TestClient(app) as test_client:
        yield test_client


def test_mindmap_job_uses_skeleton_plus_valid_annotations(client, monkeypatch):
    paper = client.post("/api/papers", files={"file": ("paper.pdf", make_pdf("Threshold Study"), "application/pdf")}).json()
    detail = client.get(f"/api/papers/{paper['id']}").json()
    unit_ids = [item["id"] for item in detail["units"]]

    async def fake_run(name, context, emit=None, thinking_budget=None):
        assert name == "mindmap_annotate"
        return {"annotations": [
            {"node_id": "sec:results", "label": "排名被阈值左右", "kind": "finding",
             "unit_ids": [unit_ids[0], "bogus-id"]},
            {"node_id": "missing-node", "label": "不该出现", "kind": "finding", "unit_ids": []},
        ]}

    monkeypatch.setattr("app.services.research_ai.run_task_events", fake_run)
    job = client.post("/api/jobs", json={"kind": "mindmap", "params": {"paper_id": paper["id"]}}).json()
    done = _wait(client, job["id"])
    assert done["status"] == "done", done
    payload = done["result"]["payload"]
    assert payload["root"]["id"] == "root"
    assert payload["annotation_count"] == 2  # 模型返回两条，节点校验在合并阶段做
    nodes = {node["id"]: node for node in mindmap_service._flatten(payload["root"])}
    assert nodes["sec:results"]["label"] == "排名被阈值左右"
    assert nodes["sec:results"]["unit_ids"] == [unit_ids[0]]
    assert "missing-node" not in nodes

    # 第二次调用应命中同一 artifact（按 parse_revision 缓存），不重复计费
    again = client.post("/api/jobs", json={"kind": "mindmap", "params": {"paper_id": paper["id"]}}).json()
    second = _wait(client, again["id"])
    assert second["result"]["id"] == done["result"]["id"]


def test_mindmap_falls_back_to_skeleton_when_ai_fails(client, monkeypatch):
    paper = client.post("/api/papers", files={"file": ("paper.pdf", make_pdf("Fallback Study"), "application/pdf")}).json()

    async def broken(name, context, emit=None, thinking_budget=None):
        raise RuntimeError("provider down")

    monkeypatch.setattr("app.services.research_ai.run_task_events", broken)
    job = client.post("/api/jobs", json={"kind": "mindmap", "params": {"paper_id": paper["id"]}}).json()
    done = _wait(client, job["id"])
    assert done["status"] == "done"
    assert done["result"]["payload"]["annotation_count"] == 0
    assert done["result"]["payload"]["root"]["children"], "AI 失败时仍应返回确定性骨架"
