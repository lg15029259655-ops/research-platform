"""Small OpenAlex adapter. Metadata never implies that a PDF was read."""

import asyncio
import re
import os
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlparse

import httpx

API = "https://api.openalex.org"
WORK_ID = re.compile(r"^W\d+$")
DISCOVERY_PAGE_SIZE = 10
SEMANTIC_RESULT_LIMIT = 50
WORK_FIELDS = (
    "id,title,display_name,authorships,publication_year,primary_topic,doi,"
    "abstract_inverted_index,cited_by_count,best_oa_location,primary_location,"
    "locations,open_access,related_works,referenced_works,topics"
)
_clients: dict[asyncio.AbstractEventLoop, httpx.AsyncClient] = {}


@asynccontextmanager
async def connection_pool():
    loop = asyncio.get_running_loop()
    async with httpx.AsyncClient(timeout=httpx.Timeout(8, connect=5), follow_redirects=True) as client:
        _clients[loop] = client
        try:
            yield
        finally:
            _clients.pop(loop)


class DiscoveryError(Exception):
    pass


class DiscoveryRateLimited(DiscoveryError):
    pass


def abstract_text(inverted: dict[str, list[int]] | None) -> str:
    if not inverted:
        return ""
    positions = [(index, word) for word, indexes in inverted.items() for index in indexes]
    return " ".join(word for _, word in sorted(positions))[:9000]


def normalize_work(raw: dict[str, Any]) -> dict[str, Any]:
    location = raw.get("best_oa_location") or {}
    primary = raw.get("primary_location") or {}
    source = primary.get("source") or location.get("source") or {}
    topic = raw.get("primary_topic") or {}
    field = topic.get("field") or {}
    pdf_locations = [item.get("pdf_url") for item in (raw.get("locations") or [])
                     if item.get("is_oa") and item.get("pdf_url")]
    fallback_pdf = location.get("pdf_url") or (primary.get("pdf_url") if primary.get("is_oa") else None)
    if fallback_pdf:
        pdf_locations.append(fallback_pdf)
    preferred_hosts = ("arxiv.org", "aclanthology.org", "pmc.ncbi.nlm.nih.gov")
    pdf_locations.sort(key=lambda url: 0 if (urlparse(url).hostname or "").lower() in preferred_hosts else 1)
    pdf_url = pdf_locations[0] if pdf_locations else None
    work_id = (raw.get("id") or "").rsplit("/", 1)[-1]
    return {
        "openalex_id": work_id,
        "title": raw.get("title") or raw.get("display_name") or "未提供标题",
        "authors": [entry.get("author", {}).get("display_name", "") for entry in (raw.get("authorships") or [])[:8]],
        "year": raw.get("publication_year"),
        "journal": source.get("display_name") or "",
        "field": field.get("display_name") or "",
        "doi": raw.get("doi") or "",
        "abstract": abstract_text(raw.get("abstract_inverted_index")),
        "citation_count": raw.get("cited_by_count") or 0,
        "oa_pdf_url": pdf_url,
        "landing_page_url": location.get("landing_page_url") or primary.get("landing_page_url"),
        "is_open_access": bool((raw.get("open_access") or {}).get("is_oa")),
        "related_ids": [(item or "").rsplit("/", 1)[-1] for item in (raw.get("related_works") or [])[:12]],
        "reference_ids": [(item or "").rsplit("/", 1)[-1] for item in (raw.get("referenced_works") or [])[:12]],
    }


async def _get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    key = os.getenv("OPENALEX_API_KEY", "").strip().strip('"').strip("'")
    headers = {"Authorization": f"Bearer {key}"} if key else None
    pooled = _clients.get(asyncio.get_running_loop())
    if pooled is not None:
        return await _get_with_retry(pooled, path, params, headers)
    async with httpx.AsyncClient(timeout=httpx.Timeout(8, connect=5), follow_redirects=True) as client:
        return await _get_with_retry(client, path, params, headers)


async def _get_with_retry(client: httpx.AsyncClient, path: str,
                          params: dict[str, Any] | None, headers: dict[str, str] | None) -> dict[str, Any]:
    for attempt in range(2):
        try:
            response = await client.get(API + path, params={"select": WORK_FIELDS, **(params or {})}, headers=headers)
            if response.status_code == 429:
                raise DiscoveryRateLimited("OpenAlex 检索额度暂时耗尽，请稍后重试")
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code < 500:
                raise DiscoveryError("OpenAlex 拒绝了检索请求，请检查检索词或服务配置") from exc
            if attempt == 1:
                raise DiscoveryError("文献检索服务暂时不可用，请稍后重试") from exc
        except (httpx.TransportError, ValueError) as exc:
            if attempt == 1:
                raise DiscoveryError("文献检索服务暂时不可用，请稍后重试") from exc
        await asyncio.sleep(0.5 * (attempt + 1))
    raise DiscoveryError("文献检索服务暂时不可用，请稍后重试")


async def search_works(query: str, page: int = 1, per_page: int = DISCOVERY_PAGE_SIZE,
                       mode: str = "semantic") -> dict[str, Any]:
    if mode not in {"semantic", "keyword"}:
        raise DiscoveryError("无效的检索模式")
    # OpenAlex semantic search accepts up to 2000 characters and returns at most 50 hits.
    search_mode = "search.semantic" if mode == "semantic" else "search"
    if mode == "semantic":
        # OpenAlex semantic search does not support topic filters. Filter its
        # bounded 50-result candidate set locally before paginating.
        data = await _get("/works", {search_mode: query[:2000], "page": 1, "per_page": SEMANTIC_RESULT_LIMIT})
        works = [work for work in data.get("results", []) if any(
            str((topic.get("domain") or {}).get("id", "")).rsplit("/", 1)[-1] in {"1", "4"}
            for topic in (work.get("topics") or [])
        )]
        total = len(works)
        works = works[(page - 1) * per_page:page * per_page]
    else:
        data = await _get("/works", {search_mode: query[:2000], "page": page, "per_page": per_page,
                                    "filter": "topics.domain.id:1|4"})
        total = (data.get("meta") or {}).get("count", 0)
        works = data.get("results", [])
    return {"items": [normalize_work(item) for item in works],
            "count": total, "page": page, "mode": mode}


async def get_work(work_id: str) -> dict[str, Any]:
    if not WORK_ID.fullmatch(work_id):
        raise DiscoveryError("无效的文献编号")
    return normalize_work(await _get(f"/works/{work_id}"))


async def graph_for_work(work_id: str) -> dict[str, Any]:
    center = await get_work(work_id)
    # Show the relations this paper actually has instead of a fixed 7+5 star.
    relation_ids = list(dict.fromkeys(center["related_ids"][:12] + center["reference_ids"][:8]))
    relation_ids = [item for item in relation_ids if WORK_ID.fullmatch(item) and item != work_id]
    neighbors = []
    if relation_ids:
        data = await _get("/works", {"filter": "openalex_id:" + "|".join(relation_ids),
                                     "per_page": len(relation_ids)})
        neighbors = [normalize_work(item) for item in data.get("results", [])]
    related = set(center["related_ids"])
    referenced = set(center["reference_ids"])
    links = [{"source": work_id, "target": item["openalex_id"],
              "relation": "references" if item["openalex_id"] in referenced else "related"}
             for item in neighbors if item["openalex_id"] in related | referenced]
    return {"nodes": [center, *neighbors], "links": links}


async def lineage_for_work(work_id: str, *, max_references: int = 24,
                           max_cited_by: int = 24, max_related: int = 12) -> dict[str, Any]:
    """三向谱系：参考文献（上游）、被引（下游）、相关研究（旁系）。

    与 graph_for_work 的区别：带方向（cites）与角色（role），供 3D 谱系图渲染
    "时间 × 引用方向"。节点抽象截断到 600 字，避免 50 节点把响应撑到几百 KB。
    """
    if not WORK_ID.fullmatch(work_id):
        raise DiscoveryError("无效的文献编号")
    raw = await _get(f"/works/{work_id}")
    center = normalize_work(raw)
    reference_ids = [(item or "").rsplit("/", 1)[-1] for item in (raw.get("referenced_works") or [])][:max_references]
    related_ids = [(item or "").rsplit("/", 1)[-1] for item in (raw.get("related_works") or [])][:max_related]

    # 中心节点缺省按 role=center 标记；后续同一篇论文不会再被覆盖角色。
    nodes: dict[str, dict[str, Any]] = {}
    def add_node(work: dict[str, Any], role: str) -> dict[str, Any]:
        item = {**work, "abstract": (work.get("abstract") or "")[:600], "role": role}
        nodes.setdefault(work["openalex_id"], item)
        return nodes[work["openalex_id"]]

    add_node(center, "center")
    edges: list[dict[str, str]] = []

    async def fetch(ids: list[str]) -> list[dict[str, Any]]:
        ids = [item for item in dict.fromkeys(ids) if item and item != work_id]
        if not ids:
            return []
        data = await _get("/works", {"filter": "openalex_id:" + "|".join(ids), "per_page": len(ids)})
        return [normalize_work(item) for item in data.get("results", [])]

    async def fetch_citing_works() -> list[dict[str, Any]]:
        try:
            data = await _get("/works", {"filter": f"cites:{work_id}", "per_page": max_cited_by,
                                         "sort": "cited_by_count:desc"})
        except DiscoveryError:
            # 下游关系缺失时，仍可展示已取得的其他关系。
            return []
        return [normalize_work(item) for item in data.get("results", [])[:max_cited_by]]

    references, citing, related = await asyncio.gather(
        fetch(reference_ids), fetch_citing_works(), fetch(related_ids), return_exceptions=True,
    )
    for result in (references, citing, related):
        if isinstance(result, BaseException):
            raise result

    # 关系按原有优先顺序合并，不依赖各请求的返回顺序。
    for work in references:
        add_node(work, "reference")
        edges.append({"source": work_id, "target": work["openalex_id"], "relation": "cites"})

    for work in citing:
        if work["openalex_id"] == work_id:
            continue
        add_node(work, "cited_by")
        edges.append({"source": work["openalex_id"], "target": work_id, "relation": "cites"})

    # 旁系：Topic 相近但无引用关系
    for work in related:
        existing = nodes.get(work["openalex_id"])
        if existing is not None and existing["role"] != "center":
            # 已经有引用关系时保留更具体的方向，不再叠加 related 边。
            continue
        add_node(work, "related")
        edges.append({"source": work_id, "target": work["openalex_id"], "relation": "related"})

    return {"center": nodes[work_id], "nodes": list(nodes.values()), "edges": edges}
