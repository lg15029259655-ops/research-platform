"""异步任务层测试：提交、幂等去重、进度事件、取消、跨用户隔离。"""

import asyncio
import time

from fastapi.testclient import TestClient

from app.main import app
from app.jobs import store, worker


async def _echo_handler(ctx: worker.JobContext) -> dict:
    await ctx.emit("stage", {"stage": "thinking", "label": "正在回显"})
    await ctx.emit("progress", {"done": 1, "total": 2})
    await asyncio.sleep(0.2)
    await ctx.emit("progress", {"done": 2, "total": 2})
    return {"kind": "test_echo", "payload": {"echo": ctx.params.get("value")}}


async def _slow_handler(ctx: worker.JobContext) -> dict:
    for _ in range(40):
        await asyncio.sleep(0.05)
        ctx.check_cancel()
    return {"kind": "test_slow", "payload": {}}


async def _fail_handler(ctx: worker.JobContext) -> dict:
    raise worker.JobFailed("模型拒绝了请求", code="ai_failed")


worker.register("test_echo", _echo_handler)
worker.register("test_slow", _slow_handler)
worker.register("test_fail", _fail_handler)


def _wait(client, job_id: str, timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        response = client.get(f"/api/jobs/{job_id}")
        assert response.status_code == 200
        snapshot = response.json()
        if snapshot["status"] in ("done", "failed", "canceled"):
            return snapshot
        time.sleep(0.02)
    raise AssertionError(f"任务超时未结束: {job_id}")


def _cleanup() -> None:
    from sqlalchemy import delete

    from app.db import SessionLocal
    from app.models import AiJob

    with SessionLocal() as db:
        db.execute(delete(AiJob).where(AiJob.kind.like("test_%")))
        db.commit()


def test_job_runs_and_exposes_result():
    with TestClient(app) as client:
        try:
            response = client.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "ok"}})
            assert response.status_code == 202
            job = response.json()
            assert job["kind"] == "test_echo"
            done = _wait(client, job["id"])
            assert done["status"] == "done"
            assert done["result"]["payload"] == {"echo": "ok"}
            assert done["stage"] == "done"
        finally:
            _cleanup()


def test_duplicate_submit_reuses_running_job():
    with TestClient(app) as client:
        try:
            first = client.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "same"}}).json()
            second = client.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "same"}}).json()
            assert first["id"] == second["id"]
            _wait(client, first["id"])
            # 任务已结束后再提交应产生新任务（结果是否过期由业务层判断）
            third = client.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "same"}}).json()
            assert third["id"] != first["id"]
            _wait(client, third["id"])
        finally:
            _cleanup()


def test_job_cancel_marks_canceled_and_keeps_worker_alive():
    with TestClient(app) as client:
        try:
            job = client.post("/api/jobs", json={"kind": "test_slow", "params": {}}).json()
            time.sleep(0.05)
            assert client.delete(f"/api/jobs/{job['id']}").json() == {"canceled": True}
            done = _wait(client, job["id"])
            assert done["status"] == "canceled"
            # worker 没有被取消连带杀死：后续任务仍能执行
            again = client.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "alive"}}).json()
            assert _wait(client, again["id"])["status"] == "done"
        finally:
            _cleanup()


def test_job_failure_returns_readable_error():
    with TestClient(app) as client:
        try:
            job = client.post("/api/jobs", json={"kind": "test_fail", "params": {}}).json()
            done = _wait(client, job["id"])
            assert done["status"] == "failed"
            assert done["error"]["code"] == "ai_failed"
            assert "模型拒绝" in done["error"]["message"]
        finally:
            _cleanup()


def test_job_is_owner_scoped():
    try:
        with TestClient(app) as owner_a:
            job = owner_a.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "a"}}).json()
            _wait(owner_a, job["id"])
        with TestClient(app) as owner_b:
            assert owner_b.get(f"/api/jobs/{job['id']}").status_code == 404
            assert owner_b.delete(f"/api/jobs/{job['id']}").status_code == 404
    finally:
        _cleanup()


def test_unknown_kind_rejected():
    with TestClient(app) as client:
        response = client.post("/api/jobs", json={"kind": "not-a-task", "params": {}})
        assert response.status_code == 422


def test_events_stream_ends_with_result():
    with TestClient(app) as client:
        try:
            job = client.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "sse"}}).json()
            with client.stream("GET", f"/api/jobs/{job['id']}/events") as response:
                assert response.status_code == 200
                body = "".join(response.iter_text())
            # 订阅可能晚于首个 stage：快照已带上当前阶段，所以只断言快照与终态事件。
            assert "event: snapshot" in body
            assert "event: result" in body
            assert '"echo": "sse"' in body
        finally:
            _cleanup()
