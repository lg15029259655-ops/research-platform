"""进程内任务 worker。

- 提交：enqueue 落库 + 入队，立即返回快照。
- 执行：全局并发上限 + 每用户并发上限，避免一个用户同时烧掉所有模型配额。
- 超时：任务级 deadline（默认 10 分钟），不再用 15/35 秒这种"必然失败"的墙钟。
- 取消：前端离开页面时调用 DELETE，worker 在下一次 checkpoint 退出。
"""

import asyncio
import hashlib
import json
import logging
from collections.abc import Awaitable, Callable

from .. import config
from . import events, store

logger = logging.getLogger(__name__)

Handler = Callable[["JobContext"], Awaitable[dict]]

_handlers: dict[str, Handler] = {}
_queue: asyncio.Queue[str] | None = None
_loop_task: asyncio.Task | None = None
_loop: asyncio.AbstractEventLoop | None = None
_running: dict[str, asyncio.Task] = {}
_global_sem: asyncio.Semaphore | None = None
_owner_sems: dict[str, asyncio.Semaphore] = {}


class JobCanceled(Exception):
    """任务被用户取消。"""


class JobFailed(Exception):
    """业务层可读失败（AI 拒绝、参数错误等）：直接作为任务错误返回给前端。"""

    def __init__(self, message: str, *, code: str = "ai_failed"):
        self.code = code
        self.message = message
        super().__init__(message)


class JobContext:
    def __init__(self, job_id: str, owner: str, kind: str, params: dict):
        self.job_id = job_id
        self.owner = owner
        self.kind = kind
        self.params = params

    async def emit(self, event: str, data: dict) -> None:
        """上报阶段/进度：既落库（轮询可见），也推给 SSE 订阅者。

        在这里检查取消标志：每个阶段边界都是一次协作式取消点，不需要业务代码
        到处写 check_cancel。
        """
        self.check_cancel()
        if event == "stage":
            store.set_stage(self.job_id, str(data.get("stage", "")), str(data.get("label", "")))
        elif event == "progress":
            store.set_progress(self.job_id, int(data.get("done", 0)), int(data.get("total", 0)))
        events.publish(self.job_id, event, data)

    def check_cancel(self) -> None:
        if store.is_cancel_requested(self.job_id):
            raise JobCanceled()


def register(kind: str, handler: Handler) -> None:
    _handlers[kind] = handler


def registered_kinds() -> tuple[str, ...]:
    return tuple(sorted(_handlers))


def _dedupe_key(owner: str, kind: str, params: dict) -> str:
    canonical = json.dumps([kind, owner, params], ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def enqueue(kind: str, owner: str, params: dict) -> dict:
    if kind not in _handlers:
        raise ValueError(f"未注册的任务类型: {kind}")
    snapshot, reused = store.create_or_reuse(owner, kind, params, _dedupe_key(owner, kind, params))
    if not reused and _queue is not None:
        _queue.put_nowait(snapshot["id"])
        events.publish(snapshot["id"], "stage", {"stage": "queued", "label": "排队中"})
    return snapshot


def enqueue_threadsafe(kind: str, owner: str, params: dict) -> None:
    """供 PDF 解析线程（threadpool）触发预计算用。"""
    if _loop is None or kind not in _handlers:
        return
    try:
        asyncio.run_coroutine_threadsafe(enqueue(kind, owner, params), _loop)
    except RuntimeError:  # 事件循环已关闭
        logger.warning("预计算任务提交失败：事件循环不可用")


def cancel(job_id: str) -> None:
    task = _running.get(job_id)
    if task is not None and not task.done():
        task.cancel()


def _owner_semaphore(owner: str) -> asyncio.Semaphore:
    sem = _owner_sems.get(owner)
    if sem is None:
        sem = asyncio.Semaphore(config.max_ai_per_owner())
        _owner_sems[owner] = sem
    return sem


async def _run(job_id: str) -> None:
    row = store.job_row(job_id)
    if row is None:
        return
    handler = _handlers.get(row["kind"])
    if handler is None:
        store.fail(job_id, "unknown_kind", "不支持的任务类型")
        return
    owner = row["owner_id"]
    context = JobContext(job_id, owner, row["kind"], row["params"])
    if store.is_cancel_requested(job_id):
        store.cancel(job_id)
        events.publish(job_id, "error", {"code": "canceled", "message": "任务已取消"})
        return
    store.mark_running(job_id)
    events.publish(job_id, "stage", {"stage": "thinking", "label": "正在处理"})
    async with _global_sem or asyncio.Semaphore(1):
        async with _owner_semaphore(owner):
            task = asyncio.create_task(handler(context))
            _running[job_id] = task
            try:
                result = await asyncio.wait_for(task, timeout=config.ai_job_deadline())
            except JobCanceled:
                store.cancel(job_id)
                events.publish(job_id, "error", {"code": "canceled", "message": "任务已取消"})
            except asyncio.TimeoutError:
                logger.warning("AI job timed out: %s kind=%s", job_id, row["kind"])
                store.fail(job_id, "timeout", "任务超过等待上限，请重试或缩小范围")
                events.publish(job_id, "error", {"code": "timeout", "message": "任务超过等待上限，请重试或缩小范围"})
            except JobFailed as exc:
                store.fail(job_id, exc.code, exc.message)
                events.publish(job_id, "error", {"code": exc.code, "message": exc.message})
            except asyncio.CancelledError:
                store.cancel(job_id)
                events.publish(job_id, "error", {"code": "canceled", "message": "任务已取消"})
                current = asyncio.current_task()
                if current is not None and current.cancelling() > 0:
                    # 外层在关闭 worker（应用退出）：必须把取消继续抛出去，
                    # 否则 worker 循环会留在下一次 await 上，TestClient/uvicorn 关不掉。
                    raise
            except Exception as exc:  # noqa: BLE001 - 任务边界必须兜住所有异常
                logger.warning("AI job failed: %s kind=%s error=%s", job_id, row["kind"], type(exc).__name__)
                store.fail(job_id, "internal", "任务执行失败，请重试")
                events.publish(job_id, "error", {"code": "internal", "message": "任务执行失败，请重试"})
            else:
                store.finish(job_id, result)
                events.publish(job_id, "result", result)
            finally:
                _running.pop(job_id, None)


async def _worker_loop() -> None:
    assert _queue is not None
    while True:
        job_id = await _queue.get()
        try:
            await _run(job_id)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - worker 不能因为单个任务崩溃
            logger.exception("AI job worker crashed on %s", job_id)
        finally:
            _queue.task_done()


def start_worker() -> None:
    global _loop, _queue, _loop_task, _global_sem
    if _loop_task is not None:
        return
    _loop = asyncio.get_running_loop()
    _queue = asyncio.Queue()
    _global_sem = asyncio.Semaphore(config.max_ai_concurrency())
    _loop_task = asyncio.create_task(_worker_loop())
    for job_id in store.resumable_ids():
        _queue.put_nowait(job_id)
    logger.info("AI job worker started; resumed %s jobs", _queue.qsize())


async def stop_worker() -> None:
    global _loop_task, _loop
    if _loop_task is not None:
        _loop_task.cancel()
        try:
            await asyncio.wait_for(_loop_task, timeout=5)
        except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
            pass
    for task in list(_running.values()):
        task.cancel()
    _loop_task = None
    _loop = None
