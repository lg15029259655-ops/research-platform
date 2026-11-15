"""任务 API：提交、快照、进度订阅（SSE）、取消。

前端只依赖这 4 个接口，具体任务类型由 jobs.handlers 注册，路由层保持稳定。
"""



from fastapi import APIRouter, Depends, HTTPException

from pydantic import BaseModel, Field
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from ..auth import current_owner
from . import events, sse, store, worker

router = APIRouter(prefix="/api/jobs")
Owner = Depends(current_owner)


class JobRequest(BaseModel):
    kind: str = Field(min_length=1, max_length=30)
    params: dict = Field(default_factory=dict)


@router.post("", status_code=202)
async def submit(request: JobRequest, owner: str = Owner):
    try:
        snapshot = await worker.enqueue(request.kind, owner, request.params)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return snapshot


@router.get("/{job_id}")
def job_status(job_id: str, owner: str = Owner):
    snapshot = store.load_owned(job_id, owner)
    if snapshot is None:
        raise HTTPException(404, "任务不存在")
    return snapshot


@router.delete("/{job_id}")
async def cancel_job(job_id: str, owner: str = Owner):
    if not store.request_cancel(job_id, owner):
        raise HTTPException(404, "任务不存在或已结束")
    worker.cancel(job_id)
    return {"canceled": True}


@router.get("/{job_id}/events")
async def job_events(job_id: str, owner: str = Owner):
    snapshot = await run_in_threadpool(store.load_owned, job_id, owner)
    if snapshot is None:
        raise HTTPException(404, "任务不存在")

    queue = events.subscribe(job_id)

    async def stream():
        try:
            current = await run_in_threadpool(store.load_owned, job_id, owner) or snapshot
            yield sse.sse_event("snapshot", current)
            if current["status"] == "done" and current.get("result") is not None:
                yield sse.sse_event("result", current["result"])
                return
            if current["status"] in ("failed", "canceled"):
                error = current.get("error") or {"code": current["status"], "message": "任务已结束"}
                yield sse.sse_event("error", error)
                return
            while True:
                item = await queue.get()
                yield sse.sse_event(item["event"], item["data"])
                if item["event"] in ("result", "error"):
                    return
        finally:
            events.unsubscribe(job_id, queue)

    return StreamingResponse(
        sse.with_heartbeat(stream(), interval=15),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
