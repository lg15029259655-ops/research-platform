"""实验流程导图：节点裁剪、AI 编排、模板兜底、任务端到端。"""

import asyncio
import time

from fastapi.testclient import TestClient

from app.main import app
from app.services import experiment_service
from app.services.research_ai import StructuredAIError

VALID_CATEGORIES = set(experiment_service.CATEGORY_NAMES)


def step(step_id: str, title: str, category: str, detail: str = "", children=None) -> dict:
    return {"id": step_id, "title": title, "category": category, "detail": detail,
            "children": children or []}


def valid_workflow(stage_count: int = 3) -> dict:
    presets = [("数据分析", "data_analysis"), ("细胞实验", "cell_experiment"),
               ("动物实验", "animal_experiment"), ("结论", "result_conclusion")]
    stages = []
    for index in range(stage_count):
        title, category = presets[index % len(presets)]
        stages.append(step(f"S{index + 1}", title, category, "阶段说明", [
            step(f"S{index + 1}-1", f"{title}子实验一", category, "子实验说明"),
            step(f"S{index + 1}-2", f"{title}子实验二", category, "子实验说明"),
        ]))
    return {"goal": "测试目标", "stages": stages}


def capture_save(monkeypatch) -> dict:
    """替换 artifact 写入：单测不需要数据库，也能断言 kind 与 payload。"""
    captured: dict = {}

    def fake_save(owner, kind, paper_ids, payload):
        captured.update({"owner": owner, "kind": kind, "paper_ids": paper_ids, "payload": payload})
        return {"id": "artifact-test", "kind": kind, "paper_ids": paper_ids,
                "payload": payload, "created_at": "2026-01-01T00:00:00"}

    monkeypatch.setattr("app.research.save_artifact", fake_save)
    return captured


def _wait(client, job_id: str, timeout: float = 6.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        snapshot = client.get(f"/api/jobs/{job_id}").json()
        if snapshot["status"] in ("done", "failed", "canceled"):
            return snapshot
        time.sleep(0.02)
    raise AssertionError(f"任务未结束: {job_id}")


# ---------------------------------------------------------------- 节点裁剪

def test_validate_accepts_ai_output_and_flattens_leaves():
    stages = experiment_service.validate_workflow(valid_workflow(4))
    assert len(stages) == 4
    assert [stage["id"] for stage in stages] == ["S1", "S2", "S3", "S4"]
    ids = [stage["id"] for stage in stages] + [child["id"] for stage in stages for child in stage["children"]]
    assert len(ids) == len(set(ids)), "id 必须全局唯一"
    for stage in stages:
        assert stage["category"] in VALID_CATEGORIES
        for child in stage["children"]:
            assert child["children"] == [], "树深最多两层，叶子 children 必须为空"
            assert child["category"] in VALID_CATEGORIES


def test_invalid_category_drops_stage_and_children_together():
    raw = {"stages": [
        step("S1", "有效阶段", "data_analysis", children=[
            step("S1-1", "有效子实验", "data_analysis"),
            step("S1-2", "错误分类子实验", "not_a_category"),
        ]),
        step("S2", "错误分类阶段", "unknown_category", children=[
            step("S2-1", "本该随阶段一起丢弃", "data_analysis"),
        ]),
        step("S3", "", "data_analysis"),  # 空标题也丢弃
    ]}
    stages = experiment_service.validate_workflow(raw)
    assert [stage["id"] for stage in stages] == ["S1"]
    assert [child["id"] for child in stages[0]["children"]] == ["S1-1"]


def test_truncates_title_and_detail():
    raw = {"stages": [step("S1", "长" * 40, "data_analysis", "详" * 100, children=[
        step("S1-1", "短" * 40, "data_analysis", "细" * 100),
    ])]}
    stages = experiment_service.validate_workflow(raw)
    assert len(stages[0]["title"]) == experiment_service.MAX_TITLE
    assert len(stages[0]["detail"]) == experiment_service.MAX_DETAIL
    assert len(stages[0]["children"][0]["title"]) == experiment_service.MAX_TITLE
    assert len(stages[0]["children"][0]["detail"]) == experiment_service.MAX_DETAIL


def test_limits_counts_and_dedupes_ids():
    raw = {"stages": [
        step("S1", f"阶段{index}", "data_analysis", children=[
            step("dup", f"子实验{child}", "data_analysis") for child in range(8)
        ]) for index in range(8)
    ]}
    stages = experiment_service.validate_workflow(raw)
    assert len(stages) == experiment_service.MAX_STAGES
    assert all(len(stage["children"]) == experiment_service.MAX_CHILDREN for stage in stages)
    ids = [stage["id"] for stage in stages] + [child["id"] for stage in stages for child in stage["children"]]
    assert len(ids) == len(set(ids))


def test_non_dict_payload_returns_empty():
    assert experiment_service.validate_workflow({}) == []
    assert experiment_service.validate_workflow({"stages": "oops"}) == []


# ---------------------------------------------------------------- AI / 模板

def test_ai_success_marks_generated_by_ai(monkeypatch):
    captured = capture_save(monkeypatch)

    async def fake_task(name, context):
        assert name == "experiment_workflow"
        assert context["goal"] == "用单细胞测序分析肿瘤耐药"
        assert {item["id"] for item in context["categories"]} == VALID_CATEGORIES
        return valid_workflow(4)

    monkeypatch.setattr(experiment_service, "run_task", fake_task)
    result = asyncio.run(experiment_service.execute_experiment(
        "owner-1", "用单细胞测序分析肿瘤耐药", "经费有限"))

    assert captured["kind"] == "experiment_workflow"
    assert captured["paper_ids"] == []
    payload = captured["payload"]
    assert payload["generated_by"] == "ai"
    assert payload["goal"] == "用单细胞测序分析肿瘤耐药"
    assert payload["constraints"] == "经费有限"
    assert len(payload["stages"]) == 4
    assert result["kind"] == "experiment_workflow"


def test_structured_error_falls_back_to_template(monkeypatch):
    captured = capture_save(monkeypatch)

    async def broken(name, context):
        raise StructuredAIError("模型返回不可用")

    monkeypatch.setattr(experiment_service, "run_task", broken)
    asyncio.run(experiment_service.execute_experiment("owner-1", "研究目标至少五个字"))

    payload = captured["payload"]
    assert payload["generated_by"] == "template"
    assert len(payload["stages"]) >= experiment_service.MIN_STAGES
    assert all(stage["category"] in VALID_CATEGORIES for stage in payload["stages"])


def test_timeout_falls_back_to_template(monkeypatch):
    captured = capture_save(monkeypatch)

    async def slow(name, context):
        await asyncio.sleep(0.3)
        return valid_workflow()

    monkeypatch.setattr(experiment_service, "run_task", slow)
    asyncio.run(experiment_service.execute_experiment("owner-1", "研究目标至少五个字", timeout=0.01))

    payload = captured["payload"]
    assert payload["generated_by"] == "template"
    assert len(payload["stages"]) >= experiment_service.MIN_STAGES


def test_too_few_stages_uses_template(monkeypatch):
    captured = capture_save(monkeypatch)

    async def short(name, context):
        return valid_workflow(2)

    monkeypatch.setattr(experiment_service, "run_task", short)
    asyncio.run(experiment_service.execute_experiment("owner-1", "研究目标至少五个字"))

    payload = captured["payload"]
    assert payload["generated_by"] == "template"
    assert len(payload["stages"]) >= experiment_service.MIN_STAGES


def test_template_contains_no_invented_numbers():
    """模板是兜底视觉，绝不能出现编造的样本量/浓度/剂量等具体数值。"""
    import re

    for goal in ("用单细胞测序分析肿瘤耐药", "钙钛矿太阳能电池稳定性", "有限元仿真结构可靠性",
                 "教育政策对学生的影响", "改进异常检测算法"):
        for stage in experiment_service.template_stages(goal):
            text = stage["title"] + stage["detail"] + "".join(
                child["title"] + child["detail"] for child in stage["children"])
            assert not re.search(r"\d", text), f"模板不应含数字: {text[:40]}"


# ---------------------------------------------------------------- 任务端到端

def test_job_end_to_end(monkeypatch):
    async def fake_task(name, context):
        return valid_workflow(4)

    monkeypatch.setattr(experiment_service, "run_task", fake_task)
    with TestClient(app) as client:
        job = client.post("/api/jobs", json={
            "kind": "experiment",
            "params": {"goal": "如何降低单细胞测序的样本与计算成本", "constraints": "经费有限"},
        }).json()
        assert job["kind"] == "experiment"
        done = _wait(client, job["id"])
        assert done["status"] == "done", done
        result = done["result"]
        assert result["kind"] == "experiment_workflow"
        assert result["payload"]["generated_by"] == "ai"
        assert len(result["payload"]["stages"]) >= experiment_service.MIN_STAGES
        assert result["payload"]["constraints"] == "经费有限"


def test_job_rejects_short_goal():
    with TestClient(app) as client:
        job = client.post("/api/jobs", json={
            "kind": "experiment", "params": {"goal": "短"},
        }).json()
        done = _wait(client, job["id"])
        assert done["status"] == "failed"
        assert done["error"]["code"] == "invalid_params"
        assert "5" in done["error"]["message"]
