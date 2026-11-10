import json
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx
from app import config as _config  # noqa: F401 - load backend/.env


class AIConfigurationError(Exception):
    pass


class AIServiceResponseError(RuntimeError):
    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"百炼请求失败，HTTP {status_code}")


# 思考模式下模型可能长时间不产出正文，但会持续产出 reasoning_content。
# read 只用来判断"真的一点数据都没有"，因此比原来的统一 120 s 更精确：
# 连接 20 s、写入 30 s、池 30 s，避免把长思考误判成网络故障。
REQUEST_TIMEOUT = httpx.Timeout(connect=20, read=90, write=30, pool=30)


def model_config(vision: bool = False) -> tuple[str, str, str]:
    key = os.getenv("BAILIAN_API_KEY", "").strip()
    base_url = os.getenv("BAILIAN_BASE_URL", "").strip().rstrip("/")
    model = os.getenv("BAILIAN_VISION_MODEL" if vision else "BAILIAN_TEXT_MODEL", "").strip()
    if not all((key, base_url, model)):
        raise AIConfigurationError("请先在 backend/.env 配置百炼 API Key、Base URL 和文本模型")
    if not base_url.startswith("https://"):
        raise AIConfigurationError("BAILIAN_BASE_URL 必须以 https:// 开头")
    return key, base_url, model


def text_config() -> tuple[str, str, str]:
    return model_config(False)


def request_body(
    model: str,
    messages: list[dict[str, Any]],
    *,
    fast_structured: bool = False,
    thinking_budget: int | None = None,
) -> dict[str, Any]:
    """拼请求体。抽成函数是为了让"关思考/限思考预算"有唯一入口，也便于测试断言。"""
    body: dict[str, Any] = {"model": model, "messages": messages, "stream": True}
    # Qwen 3.7 Flash enables thinking by default. Comparison and design use
    # a latency-sensitive structured mode; other models and reading stay unchanged.
    if fast_structured and model.lower().startswith("qwen3.7-flash"):
        body["enable_thinking"] = False
    # thinking_budget 是官方支持的思考预算参数（也映射 reasoning_effort）。
    # 只有调用方显式给出时才写，避免改变 reading / X-Ray 等默认行为。
    if thinking_budget is not None:
        body["thinking_budget"] = int(thinking_budget)
    return body


async def stream_events(
    messages: list[dict[str, Any]],
    *,
    vision: bool = False,
    fast_structured: bool = False,
    thinking_budget: int | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """逐条 yield {"type": "reasoning"|"content", "content": str}。

    同一条 delta 里可能同时出现 reasoning_content 与 content（思考模式切换到正文的
    那个包），所以两者独立判断、按 reasoning 在前的顺序各产出一条事件。
    """
    key, base_url, model = model_config(vision)
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body = request_body(model, messages, fast_structured=fast_structured,
                        thinking_budget=thinking_budget)
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        async with client.stream("POST", f"{base_url}/chat/completions", headers=headers, json=body) as response:
            if response.status_code >= 400:
                raise AIServiceResponseError(response.status_code)
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    payload = json.loads(data)
                    delta = payload.get("choices", [{}])[0].get("delta") or {}
                except (ValueError, IndexError, KeyError, TypeError):
                    continue
                reasoning = delta.get("reasoning_content")
                if isinstance(reasoning, str) and reasoning:
                    yield {"type": "reasoning", "content": reasoning}
                content = delta.get("content")
                if isinstance(content, str) and content:
                    yield {"type": "content", "content": content}


async def stream_completion(messages: list[dict[str, Any]], *, vision: bool = False, fast_structured: bool = False) -> AsyncIterator[str]:
    """只产出正文的旧接口：内部改为消费 stream_events，异常语义保持不变。"""
    async for event in stream_events(messages, vision=vision, fast_structured=fast_structured):
        if event["type"] == "content":
            yield event["content"]
