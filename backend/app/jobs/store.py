"""ai_jobs 的持久化操作：创建、去重、状态推进、快照序列化。

去重只针对"进行中"的任务：同一资源连点不会重复调用模型；已经完成的任务不会被
复用，因为结果是否过期应该由业务层按论文/解析版本判断（例如重新解析后必须重算）。
"""

import json
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select

from ..db import SessionLocal
from ..models import AiJob

TERMINAL = ("done", "failed", "canceled")


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def snapshot(job: AiJob) -> dict:
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "stage": job.stage,
        "stage_label": job.stage_label,
        "progress": json.loads(job.progress_json) if job.progress_json else None,
        "result": json.loads(job.result_json) if job.result_json else None,
        "error": {"code": job.error_code, "message": job.error_message} if job.error_code else None,
        "created_at": _iso(job.created_at),
        "finished_at": _iso(job.finished_at),
    }


def load(job_id: str) -> dict | None:
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        return snapshot(job) if job else None


def load_owned(job_id: str, owner: str) -> dict | None:
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        if job is None or job.owner_id != owner:
            return None
        return snapshot(job)


def create_or_reuse(owner: str, kind: str, params: dict, dedupe_key: str) -> tuple[dict, bool]:
    """返回 (快照, 是否复用了进行中的任务)。"""
    with SessionLocal() as db:
        existing = db.scalar(
            select(AiJob).where(
                AiJob.owner_id == owner,
                AiJob.dedupe_key == dedupe_key,
                AiJob.status.in_(("queued", "running")),
            )
        )
        if existing is not None:
            return snapshot(existing), True
        job = AiJob(
            id=str(uuid4()),
            owner_id=owner,
            kind=kind,
            dedupe_key=dedupe_key,
            params_json=json.dumps(params, ensure_ascii=False),
            status="queued",
            stage="queued",
            stage_label="排队中",
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        return snapshot(job), False


def params_of(job_id: str) -> dict:
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        return json.loads(job.params_json) if job and job.params_json else {}


def job_row(job_id: str) -> dict | None:
    """worker 需要的内部字段（含 owner 与原始参数）。"""
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        if job is None:
            return None
        return {
            "id": job.id,
            "owner_id": job.owner_id,
            "kind": job.kind,
            "params": json.loads(job.params_json or "{}"),
            "status": job.status,
        }


def mark_running(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        if job is None:
            return
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.stage = "thinking"
        job.stage_label = "正在处理"
        db.commit()


def requeue_after_shutdown(job_id: str) -> bool:
    """Keep unfinished work resumable when this process is stopping."""
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        if job is None or job.status != "running" or job.cancel_requested:
            return False
        job.status = "queued"
        job.stage = "queued"
        job.stage_label = "服务重启后等待恢复"
        job.started_at = None
        job.progress_json = None
        db.commit()
        return True


def set_stage(job_id: str, stage: str, label: str) -> None:
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        if job is None:
            return
        job.stage = stage
        job.stage_label = label
        db.commit()


def set_progress(job_id: str, done: int, total: int) -> None:
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        if job is None:
            return
        job.progress_json = json.dumps({"done": int(done), "total": int(total)})
        db.commit()


def finish(job_id: str, result: dict) -> None:
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        if job is None:
            return
        job.status = "done"
        job.stage = "done"
        job.stage_label = "已完成"
        job.result_json = json.dumps(result, ensure_ascii=False)
        job.finished_at = datetime.now(timezone.utc)
        db.commit()


def fail(job_id: str, code: str, message: str) -> None:
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        if job is None:
            return
        job.status = "failed"
        job.stage = "failed"
        job.stage_label = "失败"
        job.error_code = code
        job.error_message = message
        job.finished_at = datetime.now(timezone.utc)
        db.commit()


def cancel(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        if job is None:
            return
        job.status = "canceled"
        job.stage = "canceled"
        job.stage_label = "已取消"
        job.error_code = "canceled"
        job.error_message = "任务已取消"
        job.finished_at = datetime.now(timezone.utc)
        db.commit()


def request_cancel(job_id: str, owner: str) -> bool:
    """仅允许取消自己的、进行中的任务。"""
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        if job is None or job.owner_id != owner or job.status in TERMINAL:
            return False
        job.cancel_requested = True
        db.commit()
        return True


def is_cancel_requested(job_id: str) -> bool:
    with SessionLocal() as db:
        job = db.get(AiJob, job_id)
        return bool(job and job.cancel_requested)


def resumable_ids() -> list[str]:
    """进程重启后需要重新入队的任务。"""
    with SessionLocal() as db:
        rows = db.scalars(select(AiJob).where(
            AiJob.status.in_(("queued", "running"))
        ).order_by(AiJob.created_at, AiJob.id)).all()
        ids = []
        for job in rows:
            if job.cancel_requested:
                job.status = "canceled"
                job.stage = "canceled"
                job.stage_label = "已取消"
                job.error_code = "canceled"
                job.error_message = "任务已取消"
                job.finished_at = datetime.now(timezone.utc)
                continue
            job.status = "queued"
            job.stage = "queued"
            job.stage_label = "排队中"
            job.started_at = None
            job.progress_json = None
            ids.append(job.id)
        db.commit()
        return ids
