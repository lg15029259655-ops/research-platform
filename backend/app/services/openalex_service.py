"""Small OpenAlex adapter. Metadata never implies that a PDF was read."""

import asyncio
import re
import os
from typing import Any
from urllib.parse import urlparse

import httpx

API = "https://api.openalex.org"
WORK_ID = re.compile(r"^W\d+$")


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
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                response = await client.get(API + path, params=params, headers=headers)
                if response.status_code == 429:
                    raise DiscoveryRateLimited("OpenAlex 检索额度暂时耗尽，请稍后重试")
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code < 500:
                raise DiscoveryError("OpenAlex 拒绝了检索请求，请检查检索词或服务配置") from exc
            if attempt == 2:
                raise DiscoveryError("文献检索服务暂时不可用，请稍后重试") from exc
        except (httpx.TransportError, ValueError) as exc:
            if attempt == 2:
                raise DiscoveryError("文献检索服务暂时不可用，请稍后重试") from exc
        await asyncio.sleep(0.5 * (attempt + 1))
    raise DiscoveryError("文献检索服务暂时不可用，请稍后重试")


async def search_works(query: str, page: int = 1, per_page: int = 10,
                       mode: str = "semantic") -> dict[str, Any]:
    if mode not in {"semantic", "keyword"}:
        raise DiscoveryError("无效的检索模式")
    # OpenAlex semantic search accepts up to 2000 characters and returns at most 50 hits.
    search_mode = "search.semantic" if mode == "semantic" else "search"
    data = await _get("/works", {search_mode: query[:2000], "page": page, "per_page": per_page})
    total = (data.get("meta") or {}).get("count", 0)
    if mode == "semantic":
        total = min(total, 50)
    return {"items": [normalize_work(item) for item in data.get("results", [])],
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
