"""异步任务层测试：提交、幂等去重、进度事件、取消、跨用户隔离。"""

import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from threading import Event
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.jobs import sse, store, worker


def test_novelty_job_preserves_search_error(monkeypatch):
    from types import SimpleNamespace
    from fastapi import HTTPException
    from app.jobs import handlers
    import pytest

    async def fail_search(*args, **kwargs):
        raise HTTPException(503, "文献检索暂时不可用")

    monkeypatch.setattr(handlers, "execute_novelty", fail_search)
    ctx = SimpleNamespace(params={"query": "测试生物研究问题"}, owner="test", emit=None)
    with pytest.raises(worker.JobFailed, match="文献检索暂时不可用") as error:
        asyncio.run(handlers._run_novelty(ctx))
    assert error.value.code == "search_failed"


def test_novelty_job_exposes_search_hits_while_model_is_running(monkeypatch):
    model_started = Event()
    release_model = Event()
    query = "Compare predictive calibration methods"
    hit = {"openalex_id": "W123", "title": "Calibration study", "abstract": "Methods", "year": 2024}

    async def search(*_args):
        return {"items": [hit], "cached": False, "fetched_at": "2026-01-01T00:00:00+00:00"}

    async def model(*_args, **_kwargs):
        model_started.set()
        assert await asyncio.to_thread(release_model.wait, 5)
        return {"similar_papers": [{"openalex_id": "W123"}]}

    monkeypatch.setattr("app.research.semantic_discovery", search)
    monkeypatch.setattr("app.research._run_task", model)
    with TestClient(app) as client:
        try:
            client.get("/api/session")
            response = client.post("/api/jobs", json={"kind": "novelty", "params": {"query": query}})
            assert response.status_code == 202
            job_id = response.json()["id"]
            assert model_started.wait(3)
            snapshot = client.get(f"/api/jobs/{job_id}").json()
            assert snapshot["status"] == "running"
            assert snapshot["result"] is None
            assert snapshot["preview"] == {"query": query, "papers": [
                {"openalex_id": "W123", "title": "Calibration study", "year": 2024}
            ]}
            assert not client.get("/api/workspace").json()["novelty_id"]
            release_model.set()
            result = _wait(client, job_id)
            assert result["status"] == "done"
            assert result["preview"] is None
            assert result["result"]["payload"]["similar_papers"][0]["abstract"] == "Methods"
        finally:
            release_model.set()
            _cleanup()


def test_novelty_job_with_no_search_hits_skips_the_model(monkeypatch):
    async def search(*_args):
        return {"items": [], "cached": False, "fetched_at": "2026-01-01T00:00:00+00:00"}

    async def model(*_args, **_kwargs):
        raise AssertionError("Model should not interpret an empty result")

    monkeypatch.setattr("app.research.semantic_discovery", search)
    monkeypatch.setattr("app.research._run_task", model)
    with TestClient(app) as client:
        try:
            job = client.post("/api/jobs", json={"kind": "novelty", "params": {"query": "No results expected"}}).json()
            done = _wait(client, job["id"])
            assert done["status"] == "done"
            assert done["result"]["payload"]["search_only"] is True
            assert done["result"]["payload"]["similar_papers"] == []
        finally:
            _cleanup()


def test_terminal_event_survives_full_subscriber_queue():
    from app.jobs import events

    async def exercise():
        queue = events.subscribe("full-queue-test")
        try:
            for index in range(256):
                events.publish("full-queue-test", "progress", {"done": index})
            events.publish("full-queue-test", "result", {"value": "finished"})
            items = [queue.get_nowait() for _ in range(queue.qsize())]
            assert items[-1] == {"event": "result", "data": {"value": "finished"}}
        finally:
            events.unsubscribe("full-queue-test", queue)

    asyncio.run(exercise())


def test_sse_heartbeat_preserves_pending_read_and_applies_backpressure():
    async def exercise():
        ready = asyncio.Event()
        consumed = []
        closed = asyncio.Event()

        async def source():
            try:
                await ready.wait()
                for index in range(3):
                    consumed.append(index)
                    yield str(index)
                await asyncio.Event().wait()
            finally:
                closed.set()

        stream = sse.with_heartbeat(source(), interval=0.01)
        try:
            assert await anext(stream) == ": ping\n\n"
            ready.set()
            assert await anext(stream) == "0"
            await asyncio.sleep(0.02)
            assert consumed == [0]
            assert await anext(stream) == "1"
            assert await anext(stream) == "2"
            assert await anext(stream) == ": ping\n\n"
        finally:
            await stream.aclose()
        assert closed.is_set()

    asyncio.run(exercise())


def test_sse_keeps_unicode_line_separator_inside_json():
    payload = {"text": "第一行\u2028第二行"}
    data = sse.sse_event("result", payload).split("\n")[1].removeprefix("data: ")
    assert json.loads(data) == payload


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


def test_different_owners_run_concurrently_without_exceeding_limit(monkeypatch):
    monkeypatch.setenv("AI_MAX_CONCURRENCY", "2")
    monkeypatch.setenv("AI_MAX_PER_OWNER", "1")
    with TestClient(app) as client:
        try:
            client.get("/api/session")
            slow = client.post("/api/jobs", json={"kind": "test_slow", "params": {}}).json()
            time.sleep(0.1)
            client.cookies.clear()
            client.get("/api/session")
            fast = client.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "other user"}}).json()
            finished = _wait(client, fast["id"], timeout=1.2)
            assert finished["status"] == "done"
            assert finished["result"]["payload"]["echo"] == "other user"
        finally:
            _cleanup()


def test_one_owners_waiting_jobs_do_not_starve_another(monkeypatch):
    monkeypatch.setenv("AI_MAX_CONCURRENCY", "2")
    monkeypatch.setenv("AI_MAX_PER_OWNER", "1")
    with TestClient(app) as client:
        try:
            client.get("/api/session")
            client.post("/api/jobs", json={"kind": "test_slow", "params": {"case": "owner-a"}})
            time.sleep(0.1)
            client.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "queued-a"}})
            time.sleep(0.1)
            client.cookies.clear()
            client.get("/api/session")
            fast = client.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "owner-b"}}).json()
            assert _wait(client, fast["id"], timeout=1.2)["status"] == "done"
        finally:
            _cleanup()


def test_worker_respects_global_concurrency_limit(monkeypatch):
    monkeypatch.setenv("AI_MAX_CONCURRENCY", "2")
    monkeypatch.setenv("AI_MAX_PER_OWNER", "1")
    running = 0
    peak = 0
    completed = []

    async def capacity_handler(ctx):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        try:
            await asyncio.sleep(0.3)
            completed.append(ctx.job_id)
            return {"ok": True}
        finally:
            running -= 1

    worker.register("test_capacity", capacity_handler)
    try:
        with TestClient(app) as client:
            try:
                for _ in range(3):
                    client.cookies.clear()
                    client.get("/api/session")
                    job = client.post("/api/jobs", json={"kind": "test_capacity", "params": {}}).json()
                assert _wait(client, job["id"], timeout=3)["status"] == "done"
                assert peak == 2
                assert len(completed) == 3
            finally:
                _cleanup()
    finally:
        worker._handlers.pop("test_capacity", None)


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


def test_submission_receipts_survive_completion_and_restart_without_requeueing():
    receipt = str(uuid4())
    second_receipt = str(uuid4())
    path = f"/api/jobs/submissions/{receipt}"
    request = {"kind": "test_echo", "params": {"value": "same"}, "request_id": receipt}
    try:
        with TestClient(app) as client:
            first = client.post("/api/jobs", json=request).raise_for_status().json()
            duplicate = client.post("/api/jobs", json={**request, "request_id": second_receipt}).raise_for_status().json()
            assert first["id"] == duplicate["id"]
            finished = _wait(client, first["id"])
            assert finished["status"] == "done"
            assert client.get(f"/api/jobs/submissions/{second_receipt}").json() == finished
            cookies = dict(client.cookies)
        with TestClient(app, cookies=cookies) as reopened:
            assert reopened.get(path).json() == finished
            assert reopened.post("/api/jobs", json=request).json() == finished
            assert reopened.post("/api/jobs", json={**request, "params": {"value": "different"}}).status_code == 409
            fresh = reopened.post("/api/jobs", json={**request, "request_id": str(uuid4())}).raise_for_status().json()
            assert fresh["id"] != first["id"]
            assert _wait(reopened, fresh["id"])["status"] == "done"
        with TestClient(app) as stranger:
            assert stranger.get(path).status_code == 404
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


def test_cancel_waiting_job_is_immediate_and_never_runs(monkeypatch):
    monkeypatch.setenv("AI_MAX_CONCURRENCY", "2")
    monkeypatch.setenv("AI_MAX_PER_OWNER", "1")
    with TestClient(app) as client:
        try:
            slow = client.post("/api/jobs", json={"kind": "test_slow", "params": {"case": "occupy"}}).json()
            time.sleep(0.1)
            waiting = client.post("/api/jobs", json={"kind": "test_echo", "params": {"value": "waiting"}}).json()
            time.sleep(0.1)
            assert client.get(f"/api/jobs/{waiting['id']}").json()["status"] == "queued"
            assert client.delete(f"/api/jobs/{waiting['id']}").status_code == 200
            assert _wait(client, waiting["id"], timeout=0.5)["status"] == "canceled"
            assert _wait(client, slow["id"], timeout=4)["status"] == "done"
            assert client.get(f"/api/jobs/{waiting['id']}").json()["status"] == "canceled"
        finally:
            _cleanup()


def test_queued_research_job_uses_workspace_at_submission(monkeypatch):
    monkeypatch.setenv("AI_MAX_CONCURRENCY", "2")
    monkeypatch.setenv("AI_MAX_PER_OWNER", "1")

    async def model_must_not_run(*_args, **_kwargs):
        raise AssertionError("A stale job should be rejected before contacting the model")

    monkeypatch.setattr("app.research._run_task", model_must_not_run)
    with TestClient(app) as client:
        try:
            client.patch("/api/workspace", json={"query": "original topic"})
            blocker = client.post("/api/jobs", json={"kind": "test_slow"}).json()
            job = client.post("/api/jobs", json={"kind": "novelty", "params": {"query": "original idea"}}).json()
            assert client.get(f"/api/jobs/{job['id']}").json()["status"] == "queued"
            client.patch("/api/workspace", json={"query": "new topic"})
            assert client.delete(f"/api/jobs/{blocker['id']}").status_code == 200
            result = _wait(client, job["id"])
            assert result["status"] == "failed"
            assert "工作区已变化" in result["error"]["message"]
            assert client.get("/api/workspace").json()["query"] == "new topic"
        finally:
            _cleanup()


def test_graceful_restart_requeues_unfinished_job():
    from app.auth import COOKIE_NAME

    try:
        with TestClient(app) as first:
            job = first.post("/api/jobs", json={"kind": "test_slow", "params": {"case": "restart"}}).json()
            token = first.cookies.get(COOKIE_NAME)
            deadline = time.time() + 2
            while time.time() < deadline and first.get(f"/api/jobs/{job['id']}").json()["status"] != "running":
                time.sleep(0.02)
            assert first.get(f"/api/jobs/{job['id']}").json()["status"] == "running"
        assert store.load(job["id"])["status"] == "queued"
        with TestClient(app, cookies={COOKIE_NAME: token}) as second:
            assert _wait(second, job["id"], timeout=5)["status"] == "done"
    finally:
        _cleanup()


def test_restart_restores_queue_order_and_honors_persisted_cancellation():
    from app.db import Base, SessionLocal, engine
    from app.models import AiJob, User

    Base.metadata.create_all(engine)
    owner = str(uuid4())
    newer, older, canceled = (str(uuid4()) for _ in range(3))
    now = datetime.now(timezone.utc)
    try:
        with SessionLocal() as db:
            db.add(User(id=owner, session_hash=owner))
            db.flush()
            for job_id, created, cancel_requested in (
                (newer, now, False),
                (older, now - timedelta(seconds=1), False),
                (canceled, now - timedelta(seconds=2), True),
            ):
                db.add(AiJob(id=job_id, owner_id=owner, kind="test_echo", dedupe_key=job_id,
                             status="running", created_at=created, started_at=created,
                             progress_json='{"done": 1, "total": 2}', cancel_requested=cancel_requested))
            db.commit()

        assert [job_id for job_id in store.resumable_ids() if job_id in {newer, older, canceled}] == [older, newer]
        assert store.load(older)["status"] == "queued"
        assert store.load(older)["progress"] is None
        snapshot = store.load(canceled)
        assert snapshot["status"] == "canceled"
        assert snapshot["error"]["code"] == "canceled"
        assert snapshot["finished_at"]
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
