"""把业务层 execute_* 注册成 job worker 的任务处理器。

任务层不反向依赖业务细节：路由只认 kind，业务改动只在这里接线。
"""

from fastapi import HTTPException

from ..research import DesignRequest, execute_compare, execute_design, execute_design_insight, execute_novelty, execute_xray
from ..services.research_ai import StructuredAIError
from ..services.mindmap_service import execute_mindmap
from ..services.paper_experiment_service import execute_paper_experiments
from ..services.experiment_service import execute_experiment
from . import worker


async def _run_xray(ctx: worker.JobContext) -> dict:
    paper_id = str(ctx.params.get("paper_id") or "").strip()
    if not paper_id:
        raise worker.JobFailed("缺少论文参数", code="invalid_params")
    try:
        return await execute_xray(ctx.owner, paper_id, emit=ctx.emit)
    except StructuredAIError as exc:
        raise worker.JobFailed(str(exc), code="ai_failed") from exc
    except HTTPException as exc:
        # 论文不存在 / 还是 metadata_only / 未解析：业务校验失败要给出可读原因。
        raise worker.JobFailed(str(exc.detail), code="invalid_state") from exc


async def _run_compare(ctx: worker.JobContext) -> dict:
    paper_ids = [str(item) for item in ctx.params.get("paper_ids", [])]
    if len(paper_ids) < 2:
        raise worker.JobFailed("请选择至少两篇论文", code="invalid_params")
    try:
        return await execute_compare(ctx.owner, paper_ids, emit=ctx.emit, workspace_context=ctx.params.get("_workspace_context"))
    except StructuredAIError as exc:
        raise worker.JobFailed(str(exc), code="ai_failed") from exc
    except HTTPException as exc:
        raise worker.JobFailed(str(exc.detail), code="invalid_state") from exc


async def _run_novelty(ctx: worker.JobContext) -> dict:
    query = str(ctx.params.get("query", "")).strip()
    if len(query) < 5:
        raise worker.JobFailed("请输入至少 5 个字的研究想法", code="invalid_params")
    try:
        return await execute_novelty(ctx.owner, query, emit=ctx.emit, fallback=False, workspace_context=ctx.params.get("_workspace_context"))
    except StructuredAIError as exc:
        raise worker.JobFailed(str(exc), code="ai_failed") from exc
    except HTTPException as exc:
        raise worker.JobFailed(str(exc.detail), code="search_failed") from exc


async def _run_design(ctx: worker.JobContext) -> dict:
    raw = ctx.params.get("request") or ctx.params
    try:
        request = DesignRequest.model_validate(raw)
    except Exception as exc:  # noqa: BLE001 - 参数错误统一成可读提示
        raise worker.JobFailed("研究设计参数不完整", code="invalid_params") from exc
    try:
        return await execute_design(ctx.owner, request, emit=ctx.emit, fallback=False, workspace_context=ctx.params.get("_workspace_context"))
    except StructuredAIError as exc:
        raise worker.JobFailed(str(exc), code="ai_failed") from exc
    except HTTPException as exc:
        raise worker.JobFailed(str(exc.detail), code="ai_failed") from exc


async def _run_mindmap(ctx: worker.JobContext) -> dict:
    paper_id = str(ctx.params.get("paper_id") or "").strip()
    if not paper_id:
        raise worker.JobFailed("缺少论文参数", code="invalid_params")
    try:
        return await execute_mindmap(ctx.owner, paper_id, emit=ctx.emit)
    except HTTPException as exc:
        raise worker.JobFailed(str(exc.detail), code="invalid_state") from exc
    except LookupError as exc:
        raise worker.JobFailed(str(exc), code="not_found") from exc
    except ValueError as exc:
        raise worker.JobFailed(str(exc), code="invalid_state") from exc



async def _run_paper_experiments(ctx: worker.JobContext) -> dict:
    paper_id = str(ctx.params.get("paper_id") or "").strip()
    if not paper_id:
        raise worker.JobFailed("缺少论文参数", code="invalid_params")
    try:
        return await execute_paper_experiments(ctx.owner, paper_id, emit=ctx.emit)
    except HTTPException as exc:
        raise worker.JobFailed(str(exc.detail), code="invalid_state") from exc
    except LookupError as exc:
        raise worker.JobFailed(str(exc), code="not_found") from exc
    except ValueError as exc:
        raise worker.JobFailed(str(exc), code="invalid_state") from exc

async def _run_experiment(ctx: worker.JobContext) -> dict:
    goal = str(ctx.params.get("goal", "")).strip()
    constraints = str(ctx.params.get("constraints", "")).strip()
    # 目标太短时 AI 只会输出空话，直接在入口拦下比浪费一次调用更好；
    # 过长则直接截断/拒绝，避免把整段散文塞进提示词。
    if len(goal) < 5:
        raise worker.JobFailed("请输入至少 5 个字的研究想法", code="invalid_params")
    if len(goal) > 1500 or len(constraints) > 1500:
        raise worker.JobFailed("研究想法或约束过长（每项最多 1500 字）", code="invalid_params")
    try:
        return await execute_experiment(ctx.owner, goal, constraints, emit=ctx.emit)
    except HTTPException as exc:
        raise worker.JobFailed(str(exc.detail), code="invalid_state") from exc
async def _run_design_insight(ctx: worker.JobContext) -> dict:
    try:
        return await execute_design_insight(ctx.owner, str(ctx.params.get("artifact_id", "")), ctx.kind,
                                            str(ctx.params.get("node_id", "")), emit=ctx.emit)
    except HTTPException as exc:
        raise worker.JobFailed(str(exc.detail), code="invalid_state") from exc
    except StructuredAIError as exc:
        raise worker.JobFailed(str(exc), code="ai_failed") from exc


def register_all() -> None:
    worker.register("xray", _run_xray)
    worker.register("compare", _run_compare)
    worker.register("novelty", _run_novelty)
    worker.register("design", _run_design)
    worker.register("mindmap", _run_mindmap)
    worker.register("paper_experiments", _run_paper_experiments)
    worker.register("experiment", _run_experiment)
    worker.register("design_review", _run_design_insight)
    worker.register("design_outcomes", _run_design_insight)
