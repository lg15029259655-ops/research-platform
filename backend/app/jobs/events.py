"""进程内事件总线：worker 发布事件，SSE 端点订阅。

为什么不用 Redis：当前部署是单进程 uvicorn + SQLite，引入 broker 只会增加运维
面。任务状态本身已经落库，内存总线只负责"实时推送"，丢了就靠轮询和快照兜底。
"""

import asyncio
from collections import defaultdict


_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def subscribe(job_id: str) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=256)
    _subscribers[job_id].add(queue)
    return queue


def unsubscribe(job_id: str, queue: asyncio.Queue) -> None:
    subscribers = _subscribers.get(job_id)
    if not subscribers:
        return
    subscribers.discard(queue)
    if not subscribers:
        _subscribers.pop(job_id, None)


def publish(job_id: str, event: str, data) -> None:
    for queue in list(_subscribers.get(job_id, ())):
        try:
            queue.put_nowait({"event": event, "data": data})
        except asyncio.QueueFull:
            # Never lose the terminal signal behind a backlog of progress.
            if event not in {"result", "error"}:
                continue
            try:
                queue.get_nowait()
                queue.put_nowait({"event": event, "data": data})
            except (asyncio.QueueEmpty, asyncio.QueueFull):
                continue
