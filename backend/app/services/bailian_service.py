import json
import os
from collections.abc import AsyncIterator
from typing import Any

import httpx
from app import config as _config  # noqa: F401 - load backend/.env


class AIConfigurationError(Exception):
    pass


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


async def stream_completion(messages: list[dict[str, Any]], *, vision: bool = False) -> AsyncIterator[str]:
    key, base_url, model = model_config(vision)
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body = {"model": model, "messages": messages, "stream": True}
    async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=20)) as client:
        async with client.stream("POST", f"{base_url}/chat/completions", headers=headers, json=body) as response:
            if response.status_code >= 400:
                raise RuntimeError(f"百炼请求失败，HTTP {response.status_code}")
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    payload = json.loads(data)
                    delta = payload.get("choices", [{}])[0].get("delta", {}).get("content")
                    if isinstance(delta, str) and delta:
                        yield delta
                except (ValueError, IndexError, KeyError, TypeError):
                    continue
