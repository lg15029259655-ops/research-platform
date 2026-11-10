"""AI 服务层流式接口测试。

覆盖：
- stream_events 把 reasoning_content / content 分开产出（同一个 delta 两者都有时按 reasoning 在前）；
- stream_completion 仍然只产出正文（旧接口行为不变）；
- run_task_events 会节流上报进度，并返回 Pydantic 校验后的结构；
- mindmap_annotate 的 schema 约束（非法 kind 被拒、空数组允许）；
- 请求体开关：非 qwen3.7-flash 不发 enable_thinking，thinking_budget 会写入请求体。

不联网：把 app.services.bailian_service 模块里的 httpx 换成按预设行回放的假客户端。
"""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from app.services import bailian_service
from app.services.bailian_service import (
    AIServiceResponseError,
    stream_completion,
    stream_events,
)
from app.services.research_ai import (
    MindAnnotations,
    StructuredAIError,
    parse_json,
    run_task,
    run_task_events,
)

BASE_URL = "https://example.test/compatible-mode/v1"


def _delta(**fields: str) -> str:
    return "data: " + json.dumps({"choices": [{"delta": fields}]}, ensure_ascii=False)


class FakeResponse:
    def __init__(self, lines: list[str], status_code: int = 200) -> None:
        self._lines = lines
        self.status_code = status_code

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class FakeStream:
    def __init__(self, response: FakeResponse) -> None:
        self._response = response

    async def __aenter__(self) -> FakeResponse:
        return self._response

    async def __aexit__(self, *_exc_info) -> bool:
        return False


class FakeClient:
    """伪造 httpx.AsyncClient：记录每次请求体，并按类属性回放预设的 SSE 行。"""

    lines: list[str] = []
    status_code = 200
    calls: list[dict] = []

    def __init__(self, timeout=None, **_kwargs) -> None:
        self.timeout = timeout

    async def __aenter__(self) -> "FakeClient":
        return self

    async def __aexit__(self, *_exc_info) -> bool:
        return False

    def stream(self, method, url, headers=None, json=None):
        FakeClient.calls.append({"method": method, "url": url, "headers": headers, "json": json})
        return FakeStream(FakeResponse(FakeClient.lines, FakeClient.status_code))


@pytest.fixture
def fake_model(monkeypatch):
    FakeClient.calls = []
    FakeClient.lines = []
    FakeClient.status_code = 200
    fake_httpx = SimpleNamespace(
        AsyncClient=FakeClient,
        Timeout=httpx.Timeout,
        TransportError=httpx.TransportError,
        HTTPStatusError=httpx.HTTPStatusError,
    )
    monkeypatch.setattr(bailian_service, "httpx", fake_httpx)
    monkeypatch.setenv("BAILIAN_API_KEY", "test-key")
    monkeypatch.setenv("BAILIAN_BASE_URL", BASE_URL)
    monkeypatch.setenv("BAILIAN_TEXT_MODEL", "qwen3.7-flash")
    monkeypatch.setenv("BAILIAN_VISION_MODEL", "qwen3.7-vl")
    return FakeClient


async def _collect(source):
    return [item async for item in source]


MESSAGES = [{"role": "user", "content": "测试问题"}]


def test_stream_events_splits_reasoning_and_content(fake_model):
    fake_model.lines = [
        _delta(role="assistant", content=""),
        _delta(reasoning_content="先看题目。"),
        _delta(content="这是"),
        # 思考切换到正文的那个 delta 里两者同时出现：reasoning 必须先产出。
        _delta(reasoning_content="再核对摘要。", content="答案。"),
        "data: [DONE]",
    ]

    events = asyncio.run(_collect(stream_events(MESSAGES)))

    assert events == [
        {"type": "reasoning", "content": "先看题目。"},
        {"type": "content", "content": "这是"},
        {"type": "reasoning", "content": "再核对摘要。"},
        {"type": "content", "content": "答案。"},
    ]
    assert fake_model.calls[-1]["url"] == BASE_URL + "/chat/completions"


def test_stream_completion_yields_content_only(fake_model):
    fake_model.lines = [
        _delta(reasoning_content="这段思考不应该出现在旧接口里。"),
        _delta(content="正文"),
        _delta(content="片段"),
        "data: [DONE]",
    ]

    chunks = asyncio.run(_collect(stream_completion(MESSAGES)))

    assert chunks == ["正文", "片段"]


def test_stream_events_raises_on_http_error(fake_model):
    fake_model.status_code = 429

    with pytest.raises(AIServiceResponseError) as info:
        asyncio.run(_collect(stream_events(MESSAGES)))

    assert info.value.status_code == 429


def test_request_body_thinking_flags(fake_model, monkeypatch):
    # qwen3.7-flash + fast_structured：保持现有"关思考"逻辑。
    FakeClient.lines = ["data: [DONE]"]
    asyncio.run(_collect(stream_events(MESSAGES, fast_structured=True)))
    body = fake_model.calls[-1]["json"]
    assert body["enable_thinking"] is False
    assert "thinking_budget" not in body

    # 非 qwen3.7-flash：不发送 enable_thinking。
    monkeypatch.setenv("BAILIAN_TEXT_MODEL", "qwen3.5-plus")
    asyncio.run(_collect(stream_events(MESSAGES, fast_structured=True)))
    body = fake_model.calls[-1]["json"]
    assert "enable_thinking" not in body

    # thinking_budget 非 None 时写入请求体，且为 int。
    asyncio.run(_collect(stream_events(MESSAGES, thinking_budget=1024)))
    assert fake_model.calls[-1]["json"]["thinking_budget"] == 1024

    # 请求超时按"真没数据才失败"拆开：连接 20s，读 90s。
    assert bailian_service.REQUEST_TIMEOUT.connect == 20
    assert bailian_service.REQUEST_TIMEOUT.read == 90


def test_run_task_events_reports_progress_and_validates(monkeypatch):
    payload = json.dumps({
        "query": "测试想法",
        "similar_papers": [],
        "similarity_level": "低",
        "differences": [],
        "novel_angles": ["角度A"],
    }, ensure_ascii=False)
    chunks = [payload[index:index + 40] for index in range(0, len(payload), 40)]
    seen: dict = {}

    async def fake_stream_events(_messages, *, fast_structured=False, thinking_budget=None):
        seen["fast_structured"] = fast_structured
        seen["thinking_budget"] = thinking_budget
        yield {"type": "reasoning", "content": "思考" * 400}
        for chunk in chunks:
            yield {"type": "content", "content": chunk}

    monkeypatch.setattr("app.services.research_ai.stream_events", fake_stream_events)
    emitted: list[dict] = []

    async def emit(event: dict) -> None:
        emitted.append(event)

    result = asyncio.run(run_task_events("novelty_analysis", {"query": "测试想法"},
                                         emit=emit, thinking_budget=2048))

    assert result["similarity_level"] == "低"
    assert result["novel_angles"] == ["角度A"]
    # 结构化任务（novelty）不关思考；预算参数要透传到流式层。
    assert seen == {"fast_structured": False, "thinking_budget": 2048}

    assert emitted, "emit 至少要被调用一次"
    assert all(event["type"] == "progress" for event in emitted)
    assert all(event["total"] == 0 for event in emitted)
    assert all(isinstance(event["done"], int) for event in emitted)
    assert all(isinstance(event["label"], str) and event["label"] for event in emitted)
    # 节流：chunk 数远多于事件数，且 done 单调不减、落点是完整长度。
    assert len(emitted) <= len(chunks) // 2 + 2
    assert [event["done"] for event in emitted] == sorted(event["done"] for event in emitted)
    assert emitted[-1]["done"] == len(payload)


def test_run_task_without_emit_keeps_working(monkeypatch):
    """run_task 旧入口不能被进度逻辑改变：仍走 stream_completion、无 emit、结果不变。"""

    async def fake_completion(_messages, *, fast_structured=False):
        yield json.dumps({
            "query": "旧入口", "similar_papers": [], "similarity_level": "中",
            "differences": [], "novel_angles": []}, ensure_ascii=False)

    monkeypatch.setattr("app.services.research_ai.stream_completion", fake_completion)
    result = asyncio.run(run_task("novelty_analysis", {"query": "旧入口"}))
    assert result["similarity_level"] == "中"


def test_mindmap_annotations_schema():
    empty = parse_json(json.dumps({"annotations": []}), MindAnnotations)
    assert empty["annotations"] == []

    good = parse_json(json.dumps({"annotations": [{
        "node_id": "N2", "label": "样本量不足", "kind": "limitation", "unit_ids": ["p:3"],
    }]}, ensure_ascii=False), MindAnnotations)
    assert good["annotations"][0]["kind"] == "limitation"
    assert good["annotations"][0]["unit_ids"] == ["p:3"]

    with pytest.raises(StructuredAIError):
        parse_json(json.dumps({"annotations": [{
            "node_id": "N2", "label": "错误类型", "kind": "conclusion",
        }]}, ensure_ascii=False), MindAnnotations)


def test_mindmap_annotate_is_wired_as_fast_structured_task(monkeypatch):
    calls: list[bool] = []

    async def fake_completion(_messages, *, fast_structured=False):
        calls.append(fast_structured)
        yield json.dumps({"annotations": [{
            "node_id": "N1", "label": "研究问题", "kind": "question", "unit_ids": ["p:0"],
        }]}, ensure_ascii=False)

    monkeypatch.setattr("app.services.research_ai.stream_completion", fake_completion)
    result = asyncio.run(run_task("mindmap_annotate", {"skeleton": [{"id": "N1", "heading": "Abstract"}]}))

    assert result["annotations"][0]["node_id"] == "N1"
    # mindmap_annotate 只输出 ≤24 字标注，属于同类低风险任务，走 fast_structured 分支。
    assert calls == [True]


def test_progress_emit_failure_does_not_break_generation(monkeypatch):
    """进度推送属于尽力而为：SSE 写失败不能把已生成的答案变成重试/报错。"""

    async def fake_stream_events(_messages, *, fast_structured=False, thinking_budget=None):
        yield {"type": "content", "content": json.dumps({
            "query": "容错", "similar_papers": [], "similarity_level": "高",
            "differences": [], "novel_angles": []}, ensure_ascii=False)}

    async def broken_emit(_event: dict) -> None:
        raise RuntimeError("sse writer closed")

    monkeypatch.setattr("app.services.research_ai.stream_events", fake_stream_events)
    result = asyncio.run(run_task_events("novelty_analysis", {"query": "容错"}, emit=broken_emit))
    assert result["similarity_level"] == "高"
