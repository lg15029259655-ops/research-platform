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
    def real(uid: str, kind: str, heading: str, text: str) -> ReadingUnit:
        return ReadingUnit(id=uid, paper_id="p1", position=int(uid.split(":")[-1]), kind=kind,
                           heading=heading, page_start=1, page_end=1, source_text=text)
    units = [real("p1:0", "ABSTRACT", "摘要", "本研究旨在解决阈值选择问题，并提出三种指标。"),
             real("p1:1", "METHODS", "方法", "我们比较三种检测器，并使用统一设置。"),
             real("p1:2", "RESULTS", "结果", "结果表明阈值会改变排名。"),
             real("p1:3", "FIGURE", "图 1", "图 1：不同数据集上的阈值排名。"),
             real("p1:4", "DISCUSSION", "讨论", "结果受限于三个数据集，未来需要更多验证。"),
             real("p1:5", "CONCLUSION", "结论", "我们贡献了一个可复现的评估流程。")]
    first = mindmap_service.build_skeleton(paper, units)
    second = mindmap_service.build_skeleton(paper, units)
    assert first == second
    assert first["id"] == "root"
    headings = [child["label"] for child in first["children"]]
    assert "研究问题与动机" in headings
    assert "数据与方法" in headings and "主要发现" in headings
    assert headings.index("数据与方法") < headings.index("主要发现")
    evidence = next(child for child in first["children"] if child["id"] == "an:evidence")
    assert any(node["id"].startswith("pt:evidence:") for node in evidence["children"])


def test_skeleton_is_three_layers_with_sentence_points():
    """无 AI 时也要足够细：章节下必须有句子级 point，且带页码/摘要。"""
    paper = fake_paper()
    def real(uid: str, kind: str, heading: str, text: str, page: int = 1) -> ReadingUnit:
        return ReadingUnit(id=uid, paper_id="p1", position=int(uid.split(":")[-1]), kind=kind,
                           heading=heading, page_start=page, page_end=page, source_text=text)

    units = [
        real("p1:0", "ABSTRACT", "Abstract", "We test thresholds. Results suggest ranking changes."),
        real("p1:1", "METHODS", "Methods", "We compare three detectors. Settings are matched."),
        real("p1:2", "RESULTS", "Results", "Threshold choice flips the ranking. Two datasets disagree."),
        real("p1:3", "RESULTS", "Results", "Second dataset shows smaller gaps. Variance is reported."),
        real("p1:4", "FIGURE", "Figure 1", "Figure 1. Ranking by threshold across datasets."),
        real("p1:5", "CONCLUSION", "Conclusion", "A procedure, not a metric. Validation is needed."),
    ]
    tree = mindmap_service.build_skeleton(paper, units)
    stats = mindmap_service.skeleton_stats(tree)
    assert stats["sections"] >= 4  # 问题/方法/发现/证据/贡献 等分析维度
    assert stats["points"] >= 4
    assert stats["total"] == stats["sections"] + stats["points"] + 1
    for section in tree["children"]:
        assert section["children"], f"{section['label']} 没有句子级要点"
        for point in section["children"]:
            assert point["page"] is not None
            assert point["detail"], "句子级要点需要 detail"
            assert point["unit_ids"], "要点必须挂真实阅读单元"
    for section in tree["children"]:
        labels = [point["label"] for point in section["children"]]
        assert len(labels) == len(set(labels)), f"{section['label']} 内部要点重名"


def test_annotations_reject_unknown_nodes_and_units():
    paper = fake_paper()
    units = [unit("p1:0", "METHODS", "方法"), unit("p1:1", "RESULTS", "结果")]
    units[0].source_text = "我们比较三种检测器。"
    units[1].source_text = "结果表明阈值会改变排名。"
    tree = mindmap_service.build_skeleton(paper, units)
    tree = mindmap_service.apply_annotations(
        tree,
        [
            {"node_id": "an:method", "label": "阈值指标被拆成三部分", "kind": "question",
             "unit_ids": ["p1:0", "does-not-exist"]},
            {"node_id": "ghost-node", "label": "不存在的节点", "kind": "finding", "unit_ids": ["p1:0"]},
            {"node_id": "an:finding", "label": "排名被阈值左右", "kind": "not-a-kind", "unit_ids": ["p1:1"]},
        ],
        {"p1:0", "p1:1"},
    )
    nodes = {node["id"]: node for node in mindmap_service._flatten(tree)}
    assert nodes["an:method"]["label"] == "阈值指标被拆成三部分"
    assert nodes["an:method"]["unit_ids"] == ["p1:0"]
    assert nodes["an:finding"]["label"] == "排名被阈值左右"
    assert nodes["an:finding"]["kind"] == "finding"  # 非法 kind 不覆盖，保留骨架类型
    assert "ghost-node" not in nodes


def test_parse_revision_changes_with_structure():
    paper = fake_paper()
    base = [unit("p1:0", "ABSTRACT", "Abstract")]
    assert mindmap_service.parse_revision(paper, base) == mindmap_service.parse_revision(paper, base)
    longer = base + [unit("p1:1", "METHODS", "Methods")]
    assert mindmap_service.parse_revision(paper, base) != mindmap_service.parse_revision(paper, longer)
    before = mindmap_service.parse_revision(paper, base)
    base[0].source_text = "newly recognized content"
    assert mindmap_service.parse_revision(paper, base) != before
    before = mindmap_service.parse_revision(paper, base)
    base[0].heading = "Updated abstract heading"
    assert mindmap_service.parse_revision(paper, base) != before
    before = mindmap_service.parse_revision(paper, base)
    paper.title = "Updated paper title"
    assert mindmap_service.parse_revision(paper, base) != before


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
            {"node_id": "an:finding", "label": "排名被阈值左右", "kind": "finding",
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
    assert nodes["an:finding"]["label"] == "排名被阈值左右"
    assert nodes["an:finding"]["unit_ids"] == [unit_ids[0]]
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


def test_mindmap_result_is_rejected_if_paper_changes_during_generation(client, monkeypatch):
    from uuid import uuid4
    from sqlalchemy import select
    from app.db import SessionLocal
    from app.models import ResearchArtifact
    from app.papers import process_paper

    paper = client.post("/api/papers", files={"file":
        ("paper.pdf", make_pdf("Changing Study"), "application/pdf")}).json()

    async def reparse_while_generating(_name, _context, **_kwargs):
        with SessionLocal() as db:
            record = db.get(Paper, paper["id"])
            owner, path, token = record.owner_id, record.local_file_path, str(uuid4())
            record.status, record.parse_token = "uploaded", token
            db.commit()
        process_paper(paper["id"], owner, path, True, token)
        return {"annotations": []}

    monkeypatch.setattr("app.services.research_ai.run_task_events", reparse_while_generating)
    job = client.post("/api/jobs", json={"kind": "mindmap", "params": {"paper_id": paper["id"]}}).json()
    result = _wait(client, job["id"])
    assert result["status"] == "failed"
    assert "发生变化" in result["error"]["message"]
    with SessionLocal() as db:
        assert db.scalar(select(ResearchArtifact).where(ResearchArtifact.kind == "paper_mindmap",
            ResearchArtifact.paper_ids_json == f'["{paper["id"]}"]')) is None
