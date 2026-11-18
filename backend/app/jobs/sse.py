"""SSE 编码与心跳包装。

心跳是本次改造的硬要求：模型思考阶段可能十几秒不出正文 token，中间没有任何
字节到达会让浏览器/代理都认为连接已死，用户也只看到白屏。这里把任意异步字符串
流包装成"至少每 interval 秒有一个注释行"的流。

使用 asyncio.wait 保留等待中的读取。心跳超时不会取消生成器，慢客户端也不会积累无界队列。
"""

import asyncio
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import aclosing

from anyio import CancelScope


def sse_event(event: str | None, data) -> str:
    """编码一条 SSE 事件；event 为 None 时只发 data 行（兼容旧客户端）。"""
    lines = []
    if event:
        lines.append(f"event: {event}")
    payload = data if isinstance(data, str) else None
    if payload is None:
        import json

        payload = json.dumps(data, ensure_ascii=False)
    for line in payload.split("\n"):
        lines.append(f"data: {line}")
    return "\n".join(lines) + "\n\n"


async def with_heartbeat(source: AsyncGenerator[str, None], interval: float = 15.0) -> AsyncIterator[str]:
    """在 source 的两次输出之间最多空等 interval 秒，空等时补一个注释心跳。"""
    async with aclosing(source):
        while True:
            pending = asyncio.create_task(anext(source))
            try:
                while True:
                    completed, _ = await asyncio.wait({pending}, timeout=interval)
                    if completed:
                        break
                    yield ": ping\n\n"
                chunk = pending.result()
            except StopAsyncIteration:
                return
            finally:
                if not pending.done():
                    pending.cancel()
                    with CancelScope(shield=True):
                        await asyncio.gather(pending, return_exceptions=True)
            yield chunk
