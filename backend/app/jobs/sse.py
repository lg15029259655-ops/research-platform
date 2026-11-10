"""SSE 编码与心跳包装。

心跳是本次改造的硬要求：模型思考阶段可能十几秒不出正文 token，中间没有任何
字节到达会让浏览器/代理都认为连接已死，用户也只看到白屏。这里把任意异步字符串
流包装成"至少每 interval 秒有一个注释行"的流。

实现用后台泵任务 + 队列，而不是 wait_for(agen.__anext__())：
对 async generator 的 __anext__ 施加超时会在超时时取消它，可能直接关闭生成器。
"""

import asyncio
from collections.abc import AsyncIterator


def sse_event(event: str | None, data) -> str:
    """编码一条 SSE 事件；event 为 None 时只发 data 行（兼容旧客户端）。"""
    lines = []
    if event:
        lines.append(f"event: {event}")
    payload = data if isinstance(data, str) else None
    if payload is None:
        import json

        payload = json.dumps(data, ensure_ascii=False)
    for line in payload.splitlines() or [""]:
        lines.append(f"data: {line}")
    return "\n".join(lines) + "\n\n"


async def with_heartbeat(source: AsyncIterator[str], interval: float = 15.0) -> AsyncIterator[str]:
    """在 source 的两次输出之间最多空等 interval 秒，空等时补一个注释心跳。"""
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def pump() -> None:
        try:
            async for chunk in source:
                await queue.put(chunk)
        finally:
            await queue.put(None)

    task = asyncio.create_task(pump())
    try:
        while True:
            try:
                chunk = await asyncio.wait_for(queue.get(), timeout=interval)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            if chunk is None:
                break
            yield chunk
    finally:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
