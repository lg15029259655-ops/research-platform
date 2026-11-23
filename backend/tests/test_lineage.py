"""谱系数据测试：三向关系、边方向、角色不覆盖。"""

import asyncio

import pytest

from app.services import openalex_service


def _work(work_id: str, title: str, year: int = 2020, cited: int = 10) -> dict:
    return {
        "id": f"https://openalex.org/{work_id}",
        "title": title,
        "publication_year": year,
        "cited_by_count": cited,
        "authorships": [{"author": {"display_name": "A. Author"}}],
        "primary_location": {"source": {"display_name": "Journal"}},
        "primary_topic": {"field": {"display_name": "Computer Science"}},
        "abstract_inverted_index": {"abstract": [0], "text": [1]},
        "referenced_works": [],
        "related_works": [],
        "open_access": {"is_oa": False},
        "locations": [],
    }


def test_lineage_roles_and_directions(monkeypatch):
    center = _work("W1", "Center paper")
    center["referenced_works"] = ["https://openalex.org/W2", "https://openalex.org/W3"]
    center["related_works"] = ["https://openalex.org/W4", "https://openalex.org/W2"]
    started = set()
    all_started = asyncio.Event()

    async def fake_get(path, params=None):
        if path == "/works/W1":
            return center
        assert params is not None
        filter_value = params.get("filter", "")
        started.add(filter_value)
        if len(started) == 3:
            all_started.set()
        await asyncio.wait_for(all_started.wait(), timeout=2)
        if filter_value.startswith("cites:"):
            return {"results": [_work("W5", "Citing paper")]}
        if filter_value.startswith("openalex_id:"):
            ids = filter_value.split(":", 1)[1].split("|")
            return {"results": [_work(work_id, f"Paper {work_id}") for work_id in ids]}
        raise AssertionError(f"unexpected request {path} {params}")

    monkeypatch.setattr(openalex_service, "_get", fake_get)
    result = asyncio.run(openalex_service.lineage_for_work("W1"))

    by_id = {node["openalex_id"]: node for node in result["nodes"]}
    assert by_id["W1"]["role"] == "center"
    assert by_id["W2"]["role"] == "reference"
    assert by_id["W5"]["role"] == "cited_by"
    assert by_id["W4"]["role"] == "related"

    edges = {(edge["source"], edge["target"], edge["relation"]) for edge in result["edges"]}
    assert ("W1", "W2", "cites") in edges           # 中心引用上游
    assert ("W5", "W1", "cites") in edges           # 下游引用中心
    assert ("W1", "W4", "related") in edges
    assert ("W1", "W2", "related") not in edges
    # 抽象被截断，避免几十个节点把响应撑大
    assert all(len(node["abstract"]) <= 600 for node in result["nodes"])


def test_lineage_survives_missing_cited_by(monkeypatch):
    center = _work("W1", "Center paper")

    async def fake_get(path, params=None):
        if path == "/works/W1":
            return center
        raise openalex_service.DiscoveryError("cites 过滤失败")

    monkeypatch.setattr(openalex_service, "_get", fake_get)
    result = asyncio.run(openalex_service.lineage_for_work("W1"))
    assert [node["openalex_id"] for node in result["nodes"]] == ["W1"]
    assert result["edges"] == []


def test_lineage_rejects_invalid_id():
    with pytest.raises(openalex_service.DiscoveryError):
        asyncio.run(openalex_service.lineage_for_work("not-a-work-id"))
