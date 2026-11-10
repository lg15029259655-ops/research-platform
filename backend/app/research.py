"""Discovery, cross-paper synthesis, novelty review and research design."""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select

from .auth import current_owner
from .db import SessionLocal
from .models import Paper, PaperImage, ReadingUnit, ResearchArtifact, DesignVersion, DiscoveryCache
from .workspace import get_or_create
from .papers import owned_paper, paper_data, pdf_is_readable, process_paper
from .services.openalex_service import (
    DiscoveryError, DiscoveryRateLimited, get_work, graph_for_work, lineage_for_work, search_works,
)
from . import config
from .services import research_ai
from .services.remote_pdf import RemotePDFError, fetch_pdf
from .services.research_ai import StructuredAIError, Design, run_task

router = APIRouter(prefix="/api/research")
logger = logging.getLogger(__name__)
Owner = Depends(current_owner)
NOVELTY_AI_TIMEOUT = 15
DESIGN_AI_TIMEOUT = 35
FULLTEXT_AI_TIMEOUT = 35
# Multi-paper structured output and JSON repair take longer than one-paper X-Ray.
# Keep the total deadline below the deployed proxy's 300-second limit.
COMPARE_AI_TIMEOUT = 240
EVIDENCE_EXTRACTION_TIMEOUT = 20

async def _run_task(name: str, context: dict, emit=None, *, timeout: float | None = None) -> dict:
    """统一的结构化任务入口。

    优先走流式版本（可上报进度、可用思考预算）；服务层尚未提供时回退到 run_task，
    这样改造可以分步落地，互不阻塞。
    """
    runner = getattr(research_ai, "run_task_events", None)
    budget = config.thinking_budget()

    async def invoke():
        # 没有进度回调 = 旧同步调用路径：保持原行为（也方便测试与插件替换 run_task）。
        if emit is None or runner is None:
            return await run_task(name, context)

        async def forward(event: dict) -> None:
            if emit is None:
                return
            await emit(event.get("type", "progress"),
                       {key: value for key, value in event.items() if key != "type"})

        return await runner(name, context, emit=forward if emit is not None else None,
                            thinking_budget=budget)

    if timeout is not None:
        return await asyncio.wait_for(invoke(), timeout=timeout)
    return await invoke()


def cache_key(kind: str, query: str, mode: str = "", page: int = 1) -> str:
    canonical = json.dumps([kind, " ".join(query.casefold().split()), mode, page], ensure_ascii=False)
    return sha256(canonical.encode("utf-8")).hexdigest()


def cache_time(value: datetime) -> str:
    return value.replace(tzinfo=value.tzinfo or timezone.utc).isoformat()


async def cached_discovery(key: str, kind: str, query: str, mode: str, page: int, fetch, refresh: bool = False) -> dict:
    with SessionLocal() as db:
        cached = db.get(DiscoveryCache, key)
        if cached and not refresh:
            return {**json.loads(cached.payload_json), "cached": True,
                    "fetched_at": cache_time(cached.fetched_at)}
    try:
        result = await fetch()
    except DiscoveryError:
        if cached:
            return {**json.loads(cached.payload_json), "cached": True, "stale": True,
                    "fetched_at": cache_time(cached.fetched_at)}
        raise
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        row = db.get(DiscoveryCache, key)
        if row is None:
            row = DiscoveryCache(cache_key=key, kind=kind, query=query, mode=mode,
                                 page=page, payload_json="{}")
            db.add(row)
        row.payload_json = json.dumps(result, ensure_ascii=False)
        row.fetched_at = now
        db.commit()
    return {**result, "cached": False, "fetched_at": now.isoformat()}


def route_research(title: str, abstract: str = "", field: str = "") -> dict[str, str]:
    content = f"{title} {abstract}".lower()
    if any(term in content for term in ("meta-analysis", "systematic review", "scoping review",
                                        "narrative review", "progress article", "荟萃分析", "系统综述")):
        return {"domain": "review", "study_type": "evidence_synthesis", "template": "review_synthesis"}
    if any(term in content for term in ("theorem", "lemma", "proof", "axiom", "定理", "引理", "证明")):
        return {"domain": "theory", "study_type": "theoretical", "template": "theory_proof"}
    if any(term in content for term in ("finite element simulation", "computational simulation", "numerical simulation", "分子动力学模拟", "数值模拟")):
        return {"domain": "simulation", "study_type": "computational", "template": "simulation_validation"}
    if any(term in content for term in ("randomized controlled trial", "cohort study", "case-control study", "retrospective study", "prospective study", "随机对照试验", "队列研究", "病例对照研究")):
        return {"domain": "biomed", "study_type": "clinical_observational", "template": "clinical_study"}
    groups = [
        ("cs", ("algorithm", "neural network", "machine learning", "benchmark", "transformer", "算法", "计算机", "深度学习"), "cs_algorithm"),
        ("materials", ("material", "catalyst", "polymer", "alloy", "electrode", "perovskite", "材料", "催化", "电池"), "material_experiment"),
        ("engineering", ("engineering", "finite element", "robotics", "manufacturing", "control system", "structural design", "sensor network", "工程", "机器人", "传感器"), "engineering_design"),
        ("social", ("survey", "regression", "policy", "sociology", "economics", "population study", "问卷", "社会", "政策"), "social_statistics"),
        ("biomed", ("cell", "mouse", "clinical", "patient", "disease", "gene", "protein", "cancer", "tumor", "医学", "细胞", "临床", "肿瘤"), "biomed_experiment"),
    ]
    field_terms = {"cs": ("computer science",), "materials": ("materials science", "chemistry", "chemical engineering"),
                   "engineering": ("engineering", "mechanical engineering", "electrical engineering", "civil engineering"),
                   "social": ("social sciences", "economics", "psychology", "business"),
                   "biomed": ("medicine", "biochemistry", "immunology", "neuroscience", "pharmacology")}
    scored = [(sum(content.count(word) for word in words) +
               4 * any(term in field.lower() for term in field_terms[domain]), domain, template)
              for domain, words, template in groups]
    score, domain, template = max(scored, key=lambda row: row[0])
    if score == 0:
        return {"domain": "general", "study_type": "unspecified", "template": "general_research"}
    study_type = {
        "cs": "algorithm", "materials": "experiment", "engineering": "design",
        "social": "statistics", "biomed": "experiment",
    }[domain]
    return {"domain": domain, "study_type": study_type, "template": template}


def save_artifact(owner: str, kind: str, paper_ids: list[str], payload: dict) -> dict:
    artifact = ResearchArtifact(id=str(uuid4()), owner_id=owner, kind=kind,
                                paper_ids_json=json.dumps(paper_ids),
                                payload_json=json.dumps(payload, ensure_ascii=False))
    with SessionLocal() as db:
        db.add(artifact)
        workspace = get_or_create(db, owner)
        if kind == "paper_compare":
            workspace.synthesis_id = artifact.id
        elif kind == "novelty_analysis":
            workspace.novelty_id = artifact.id
            workspace.design_idea = payload.get("query", workspace.design_idea)
        elif kind == "experiment_design":
            workspace.design_version_id = artifact.id
            workspace.design_idea = payload.get("goal", workspace.design_idea)
        db.commit()
    return {"id": artifact.id, "kind": kind, "paper_ids": paper_ids, "payload": payload,
            "created_at": artifact.created_at.isoformat()}


@router.get("/route")
def classify(title: str, abstract: str = "", owner: str = Owner):
    return route_research(title[:500], abstract[:4000])


@router.get("/discover")
async def discover(q: str, page: int = 1, mode: str = "semantic", refresh: bool = False, owner: str = Owner):
    if not q.strip() or len(q) > 500 or page < 1 or page > 100 or mode not in {"semantic", "keyword"}:
        raise HTTPException(422, "请输入有效的检索词")
    if mode == "semantic" and page > 5:
        raise HTTPException(422, "语义检索最多展示 50 篇，请改用关键词检索")
    try:
        result = await cached_discovery(cache_key("search", q, mode, page), "search", q.strip(), mode, page,
            lambda: search_works(q.strip(), page, mode=mode), refresh)
    except DiscoveryRateLimited as exc:
        raise HTTPException(429, "OpenAlex 检索额度暂时耗尽。可稍后重试；如有 OpenAlex API Key，可填入后端 OPENALEX_API_KEY。") from exc
    except DiscoveryError as exc:
        logger.warning("OpenAlex discovery failed: %s", type(exc).__name__)
        raise HTTPException(503, "文献检索服务暂时不可用，请重试") from exc
    for item in result["items"]:
        item.update(route_research(item["title"], item["abstract"], item["field"]))
    return result


@router.get("/discover/cached")
def discover_cached(q: str, page: int = 1, mode: str = "semantic", owner: str = Owner):
    """Restore a previous public search without contacting OpenAlex."""
    if not q.strip() or len(q) > 500 or page < 1 or page > 100 or mode not in {"semantic", "keyword"}:
        raise HTTPException(422, "请输入有效的检索词")
    with SessionLocal() as db:
        cached = db.get(DiscoveryCache, cache_key("search", q, mode, page))
        if cached is None:
            raise HTTPException(404, "暂无已保存的检索结果")
        result = {**json.loads(cached.payload_json), "cached": True,
                  "fetched_at": cache_time(cached.fetched_at)}
    for item in result["items"]:
        item.update(route_research(item["title"], item["abstract"], item.get("field", "")))
    return result


@router.get("/lineage/{work_id}")
async def work_lineage(work_id: str, refresh: bool = False, owner: str = Owner):
    """3D 谱系图数据：上游引用 / 下游被引 / 旁系相关，带方向与角色。"""
    try:
        result = await cached_discovery(cache_key("lineage", work_id), "lineage", work_id, "", 1,
            lambda: lineage_for_work(work_id), refresh)
        for item in result["nodes"]:
            item.update(route_research(item["title"], item.get("abstract", ""), item.get("field", "")))
        result["backlinks"] = sum(1 for edge in result["edges"] if edge["relation"] == "cites")
        return result
    except DiscoveryError as exc:
        logger.warning("OpenAlex lineage failed: %s", type(exc).__name__)
        raise HTTPException(503, "文献谱系暂时无法读取，请重试") from exc


@router.get("/graph/{work_id}")
async def work_graph(work_id: str, refresh: bool = False, owner: str = Owner):
    try:
        result = await cached_discovery(cache_key("graph", work_id), "graph", work_id, "", 1,
            lambda: graph_for_work(work_id), refresh)
        for item in result["nodes"]:
            item.update(route_research(item["title"], item["abstract"], item.get("field", "")))
        return result
    except DiscoveryError as exc:
        logger.warning("OpenAlex graph failed: %s", type(exc).__name__)
        raise HTTPException(503, "文献关系暂时无法读取，请重试") from exc


class ImportRequest(BaseModel):
    openalex_id: str


@router.post("/import")
async def import_work(request: ImportRequest, owner: str = Owner):
    try:
        work = await get_work(request.openalex_id)
    except DiscoveryError as exc:
        raise HTTPException(422, "无法读取这篇文献的检索信息") from exc
    with SessionLocal() as db:
        existing = db.scalar(select(Paper).where(Paper.owner_id == owner, Paper.openalex_id == request.openalex_id))
        if existing:
            return paper_data(existing)
        paper_id = str(uuid4())
        routed = route_research(work["title"], work["abstract"], work.get("field", ""))
        paper = Paper(id=paper_id, owner_id=owner, title=work["title"],
                      original_filename="", stored_filename="", local_file_path="",
                      mime_type="", file_size_bytes=0, sha256="", status="metadata_only",
                      authors=", ".join(work["authors"]), year=work["year"],
                      journal=work["journal"], doi=work["doi"],
                      openalex_id=work["openalex_id"], abstract=work["abstract"],
                      citation_count=work["citation_count"], oa_pdf_url=work["oa_pdf_url"],
                      **routed)
        db.add(paper)
        db.commit()
        return paper_data(paper)


@router.post("/import-pdf")
async def import_open_pdf(request: ImportRequest, background_tasks: BackgroundTasks, owner: str = Owner):
    try:
        work = await get_work(request.openalex_id)
    except DiscoveryError as exc:
        raise HTTPException(422, "无法读取这篇文献的检索信息") from exc
    if not work["oa_pdf_url"]:
        raise HTTPException(422, "未找到可用开放 PDF，请手动上传")
    paper_data_item = await import_work(request, owner)
    paper_id = paper_data_item["id"]
    if paper_data_item["status"] == "parsed":
        return paper_data_item
    if paper_data_item["status"] not in {"metadata_only", "failed"}:
        raise HTTPException(409, "PDF 已在处理中，请稍后打开论文库")
    try:
        path, size, digest = await fetch_pdf(work["oa_pdf_url"], owner, paper_id)
    except RemotePDFError as exc:
        logger.warning("Open PDF retrieval failed: %s", type(exc).__name__)
        raise HTTPException(422, str(exc)) from exc
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        old_path = paper.local_file_path
        db.query(ReadingUnit).filter(ReadingUnit.paper_id == paper_id).delete()
        db.query(PaperImage).filter(PaperImage.paper_id == paper_id).delete()
        paper.current_unit_id = None
        paper.original_filename = f"{request.openalex_id}.pdf"
        paper.stored_filename = Path(path).name
        paper.local_file_path = path
        paper.mime_type = "application/pdf"
        paper.file_size_bytes = size
        paper.sha256 = digest
        paper.status = "uploaded"
        db.commit()
    if old_path and old_path != path and Path(old_path).resolve().parent == Path(path).resolve().parent:
        Path(old_path).unlink(missing_ok=True)
    background_tasks.add_task(process_paper, paper_id, owner, path)
    return {"id": paper_id, "status": "uploaded"}


class CompareRequest(BaseModel):
    paper_ids: list[str] = Field(min_length=2, max_length=5)


def fulltext_papers(owner: str, ids: list[str], *, compact: bool = False) -> list[dict]:
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "请选择不同的论文")
    papers = []
    with SessionLocal() as db:
        owned = [owned_paper(db, paper_id, owner) for paper_id in ids]
        for paper in owned:
            paper_id = paper.id
            if paper.status != "parsed":
                raise HTTPException(422, "这项分析需要全文，请先上传对应 PDF")
            if not pdf_is_readable(paper.local_file_path):
                label = paper.original_filename.strip() or paper.title.strip() or "这篇论文"
                raise HTTPException(422, f"《{label}》的 PDF 文件不可用，请先重新上传并核对原文")
            units = db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id == paper_id).order_by(ReadingUnit.position)).all()
            substantive = [unit for unit in units if unit.kind in {
                "ABSTRACT", "INTRODUCTION", "METHODS", "RESULTS", "DISCUSSION", "CONCLUSION", "BODY"
            } and unit.source_text.strip()]
            # Some reviews have no standard section headings. The parser can
            # mistakenly place many pages of body text in a single unit.
            # Preserve that existing unit as the evidence anchor, but label
            # sampled passages as unclassified rather than as an abstract.
            unclassified = next((unit for unit in substantive
                if unit.kind == "ABSTRACT" and len(unit.source_text) >= 10000
                and unit.page_start and unit.page_end
                and unit.page_end - unit.page_start >= 2), None)
            page_body = [unit for unit in substantive if unit.kind == "BODY"]
            if ((len({unit.kind for unit in substantive}) < 2 and not unclassified and len(page_body) < 2) or
                    sum(len(unit.source_text) for unit in substantive) < 60 or
                    paper.title.strip().casefold() in {"hhs public access", "author manuscript"}):
                # 从 OpenAlex 导入的论文没有上传文件，original_filename 是空串，
                # 直接拼出来就是「《》未可靠提取…」，用户看不出是哪一篇。回落用标题。
                label = paper.original_filename.strip() or paper.title.strip() or "这篇论文"
                raise HTTPException(422, f"《{label}》未可靠提取论文正文，请先在精读页重新识别；若仍不足，请换用可复制文字的 PDF")
            if compact:
                quotas = {"TITLE": 1, "ABSTRACT": 1, "INTRODUCTION": 1,
                          "METHODS": 2, "RESULTS": 3, "DISCUSSION": 1,
                          "CONCLUSION": 1, "FIGURE": 2, "TABLE": 1}
                counts: dict[str, int] = {}
                selected_units = []
                for unit in units:
                    if counts.get(unit.kind, 0) < quotas.get(unit.kind, 0) and unit.source_text.strip():
                        selected_units.append(unit)
                        counts[unit.kind] = counts.get(unit.kind, 0) + 1
                if page_body:
                    selected_units.extend(page_body[index] for index in sorted({0, len(page_body) // 2, len(page_body) - 1}))
            else:
                selected_units = [unit for unit in units if unit.kind != "RECAP"][:35]
            excerpts = [{"unit_id": unit.id, "kind": unit.kind, "heading": unit.heading,
                         "page": unit.page_start, "page_end": unit.page_end,
                         "text": unit.source_text[:1100]}
                        for unit in selected_units]
            if unclassified:
                excerpts = [item for item in excerpts if item["unit_id"] != unclassified.id]
                text = unclassified.source_text
                for offset in (0, len(text) // 3, len(text) * 2 // 3):
                    excerpts.append({"unit_id": unclassified.id, "kind": "UNCLASSIFIED",
                        "heading": "未分类正文片段（章节和页码需核对）", "page": None, "page_end": None,
                        "text": text[offset:offset + 1100]})
            papers.append({"paper_id": paper.id, "title": paper.title,
                           "domain": paper.domain or route_research(paper.title)["domain"],
                           "evidence_scope": "PDF提取的全文片段", "sections": excerpts})
    return papers


async def execute_xray(owner: str, paper_id: str, *, emit=None, timeout: float | None = None) -> dict:
    if emit is not None:
        await emit("stage", {"stage": "reading", "label": "读取论文单元"})
    context = fulltext_papers(owner, [paper_id])[0]
    with SessionLocal() as db:
        existing = db.scalar(select(ResearchArtifact).where(
            ResearchArtifact.owner_id == owner,
            ResearchArtifact.kind == "paper_summary",
            ResearchArtifact.paper_ids_json == json.dumps([paper_id]),
        ).order_by(ResearchArtifact.created_at.desc()))
        if existing and not json.loads(existing.payload_json).get("stale_after_reparse"):
            return {"id": existing.id, "kind": existing.kind,
                    "paper_ids": [paper_id], "payload": json.loads(existing.payload_json),
                    "created_at": existing.created_at.isoformat()}
    if emit is not None:
        await emit("stage", {"stage": "thinking", "label": "正在组织 Paper X-Ray"})
    payload = await _run_task("paper_summary", context, emit, timeout=timeout)
    if emit is not None:
        await emit("stage", {"stage": "validating", "label": "校验证据引用"})
    with SessionLocal() as db:
        ids = set(db.scalars(select(ReadingUnit.id).where(ReadingUnit.paper_id == paper_id)).all())
    for stage in payload["stages"]:
        stage["unit_ids"] = [item for item in stage["unit_ids"] if item in ids]
    return save_artifact(owner, "paper_summary", [paper_id], payload)


@router.post("/xray/{paper_id}")
async def paper_xray(paper_id: str, owner: str = Owner):
    try:
        return await execute_xray(owner, paper_id, timeout=FULLTEXT_AI_TIMEOUT)
    except TimeoutError as exc:
        raise HTTPException(504, "论文精读超过等待上限，请缩小范围后重试") from exc
    except StructuredAIError as exc:
        logger.warning("Paper X-Ray failed: %s", type(exc).__name__)
        raise HTTPException(503, str(exc)) from exc


async def execute_compare(owner: str, paper_ids: list[str], *, emit=None, timeout: float | None = None) -> dict:
    if emit is not None:
        await emit("stage", {"stage": "preparing", "label": "读取论文片段"})
    papers = fulltext_papers(owner, paper_ids, compact=True)
    if emit is not None:
        await emit("stage", {"stage": "comparing", "label": "比较研究问题与结果"})
    payload = await _run_task("paper_compare", {"papers": papers}, emit, timeout=timeout)
    if emit is not None:
        await emit("stage", {"stage": "validating", "label": "校验证据引用"})
    payload["extraction_warnings"] = [
        f"《{paper['title']}》部分正文未识别章节；综合使用未分类片段，页码和上下文需核对。"
        for paper in papers if any(section["kind"] in {"UNCLASSIFIED", "BODY"} for section in paper["sections"])
    ]
    allowed = set(paper_ids)
    referenced = ({item["paper_id"] for item in payload["papers"]} |
                  {cell["paper_id"] for row in payload["dimensions"] for cell in row["values"]} |
                  {pid for claim in payload["controversies"] for pid in claim["paper_ids"]})
    if not referenced.issubset(allowed):
        raise HTTPException(503, "AI 返回的论文引用不匹配，请重试")
    # Titles and paper membership are authoritative input data, not model output.
    # Models may omit a paper or paraphrase a title even when IDs are valid.
    payload["papers"] = [{"paper_id": paper["paper_id"], "title": paper["title"],
                          "domain": paper["domain"]} for paper in papers]
    for row in payload["dimensions"]:
        cells = {cell["paper_id"]: cell for cell in row["values"]}
        row["values"] = [cells.get(paper_id) or {"paper_id": paper_id,
            "value": "当前提取片段未找到可核对的该项信息，请查看原文。", "source": ""}
            for paper_id in paper_ids]
        for cell in row["values"]:
            if not cell["value"].strip():
                cell["value"] = "当前提取片段未找到可核对的该项信息，请查看原文。"
    if not payload["controversies"]:
        # A full comparison may return an empty evidence map even when a
        # single paper contains usable results. A short, bounded extraction
        # identifies single-study findings without inventing cross-paper ties.
        extraction_papers = []
        for paper in papers:
            sections = [section for section in paper["sections"]
                        if section["kind"] in {"RESULTS", "DISCUSSION", "CONCLUSION"}][:2]
            if sections:
                extraction_papers.append({"paper_id": paper["paper_id"], "sections": sections})
        candidates: dict[str, dict] = {}
        for paper in extraction_papers:
            for section in paper["sections"]:
                normalized = re.sub(r"\s+", " ", section["text"]).strip()
                sentences = [part for part in re.split(r"(?<=[.!?])\s+", normalized)
                             if 55 <= len(part) <= 450 and not part[0].islower()
                             and not re.match(r"^(?:[A-Z],\s*)+[A-Z]\s", part)
                             and not re.match(r"^(?:In\s+)?(?:these|those|this|that|their|its|we|they|our)\b", part, re.I)
                             and not re.search(r"\b(?:Fig|Figure|et al|vs|Dr)\.$", part, re.I)][:2]
                for sentence in sentences:
                    candidate_id = f"E{len(candidates) + 1}"
                    candidates[candidate_id] = {"paper_id": paper["paper_id"],
                        "unit_id": section["unit_id"], "text": sentence}
        if candidates:
            try:
                candidate_input = [{"id": key, "paper_id": value["paper_id"], "text": value["text"]}
                                   for key, value in candidates.items()]
                extracted = await asyncio.wait_for(run_task("evidence_extract", {"candidates": candidate_input}),
                                                   timeout=EVIDENCE_EXTRACTION_TIMEOUT)
                accepted_ids: set[str] = set()
                for selection in extracted.get("claims", []):
                    candidate_id = selection.get("candidate_id")
                    candidate = candidates.get(candidate_id)
                    if not candidate or candidate_id in accepted_ids:
                        continue
                    accepted_ids.add(candidate_id)
                    payload["controversies"].append({"claim": selection["claim"],
                        "paper_ids": [candidate["paper_id"]], "stance": "INSUFFICIENT",
                        "reason": "单篇研究的候选线索；原文已匹配，但命题与上下文的关系尚未独立核验，不能据此判断跨论文一致性。" + selection["reason"],
                        "evidence_refs": [{"paper_id": candidate["paper_id"], "unit_id": candidate["unit_id"], "quote": candidate["text"]}]})
                    if len(accepted_ids) >= 2:
                        break
            except (TimeoutError, StructuredAIError):
                logger.warning("Optional single-paper evidence extraction timed out or failed")
    if not payload["controversies"]:
        payload["controversies"] = [{"claim": "当前片段尚未形成可直接比较的共同命题",
            "paper_ids": paper_ids, "stance": "INSUFFICIENT",
            "reason": "本次结构化分析没有给出可核验的共同命题。请对照矩阵和论文原文后再判断。",
            "evidence_refs": []}]
    sources = {(paper["paper_id"], section["unit_id"]): section
               for paper in papers for section in paper["sections"]
               if section["kind"] != "UNCLASSIFIED"}
    for claim in payload["controversies"]:
        verified_refs = []
        direct_refs = []
        for ref in claim.get("evidence_refs", []):
            source = sources.get((ref.get("paper_id"), ref.get("unit_id")))
            if source and ref["paper_id"] in claim["paper_ids"]:
                source_text = re.sub(r"\s+", " ", source["text"]).strip()
                quote = re.sub(r"\s+", " ", ref.get("quote", "")).strip()
                quote_verified = len(quote) >= 12 and quote in source_text
                page_start, page_end = source["page"], source.get("page_end")
                precise_page = page_start if page_start and page_end == page_start else None
                verified = {"paper_id": ref["paper_id"], "unit_id": ref["unit_id"],
                    "section": source["heading"], "page": precise_page,
                    "page_start": page_start, "page_end": page_end,
                    "snippet": quote[:500] if quote_verified else source_text[:260],
                    "quote_verified": quote_verified}
                verified_refs.append(verified)
                if quote_verified and source["kind"] in {"RESULTS", "DISCUSSION", "CONCLUSION"}:
                    direct_refs.append(verified)
        if claim["stance"] == "SUPPORTS" and not direct_refs:
            claim["stance"] = "INSUFFICIENT"
            claim["reason"] += " 当前未核对到结果或讨论中的连续原文，不能列为支持。"
        elif claim["stance"] == "REFUTES" and len({ref["paper_id"] for ref in direct_refs}) < 2:
            claim["stance"] = "INSUFFICIENT"
            claim["reason"] += " 当前没有来自至少两篇论文的可核对结果原文，不能列为结果不一致。"
        claim["evidence_refs"] = (direct_refs if claim["stance"] != "INSUFFICIENT" else verified_refs)[:6]
    return save_artifact(owner, "paper_compare", paper_ids, payload)


@router.post("/compare")
async def compare(request: CompareRequest, owner: str = Owner):
    try:
        return await execute_compare(owner, request.paper_ids, timeout=COMPARE_AI_TIMEOUT)
    except TimeoutError as exc:
        raise HTTPException(504, "文献综合超过等待上限，请稍后重试；也可减少论文数量") from exc
    except StructuredAIError as exc:
        logger.warning("Comparison AI failed: %s", type(exc).__name__)
        raise HTTPException(503, str(exc)) from exc


class IdeaRequest(BaseModel):
    query: str = Field(min_length=5, max_length=800)


def search_only_novelty(query: str, works: list[dict]) -> dict:
    """Keep verified search hits visible when the optional AI interpretation is slow."""
    return {"query": query, "similar_papers": [{"openalex_id": item["openalex_id"],
        "title": item["title"], "similarity_level": "待核验", "differences": []} for item in works[:8]],
        "similarity_level": "待核验", "differences": [], "novel_angles": [],
        "search_only": True, "search_message": ("已返回相关文献；模型解读未完成，暂不判断相似程度或新颖性。"
            if works else "本次检索没有返回文献；不能据此断定该研究方向不存在。")}


async def execute_novelty(owner: str, query: str, *, emit=None, timeout: float | None = None,
                          fallback: bool = True) -> dict:
    try:
        if emit is not None:
            await emit("stage", {"stage": "searching", "label": "检索相似研究"})
        found = await cached_discovery(cache_key("search", query, "semantic", 1),
            "search", query, "semantic", 1,
            lambda: search_works(query, per_page=10))
        works = found["items"]
        if emit is not None:
            await emit("stage", {"stage": "analyzing", "label": "解读相似度与新角度"})
        try:
            payload = await _run_task("novelty_analysis", {
                "query": query,
                "evidence_scope": "OpenAlex 检索元数据与可用摘要，未读取全文",
                "papers": [{"openalex_id": item["openalex_id"], "title": item["title"],
                            "abstract": item["abstract"][:1200]} for item in works[:8]],
            }, emit, timeout=timeout)
        except (TimeoutError, StructuredAIError):
            # 异步任务路径不静默降级：宁可报错重试，也不给"看起来能用其实没解读"的结果。
            if not fallback:
                raise
            logger.warning("Novelty interpretation timed out or failed; returning search-only result")
            payload = search_only_novelty(query, works)
    except DiscoveryRateLimited as exc:
        logger.warning("Novelty search rate limited")
        raise HTTPException(429, str(exc)) from exc
    except DiscoveryError as exc:
        logger.warning("Novelty search failed: %s", type(exc.__cause__).__name__ if exc.__cause__ else type(exc).__name__)
        raise HTTPException(503, str(exc)) from exc
    allowed = {item["openalex_id"] for item in works}
    payload["similar_papers"] = [item for item in payload["similar_papers"] if item["openalex_id"] in allowed]
    by_id = {item["openalex_id"]: item for item in works}
    with SessionLocal() as db:
        owned_pdf = {paper.openalex_id for paper in db.scalars(select(Paper).where(
            Paper.owner_id == owner, Paper.status == "parsed", Paper.openalex_id.is_not(None))).all()}
    for item in payload["similar_papers"]:
        source = by_id[item["openalex_id"]]
        item["abstract"] = source["abstract"][:1000]
        item["year"] = source["year"]
        item["full_text_available"] = item["openalex_id"] in owned_pdf
    payload["query"] = query
    payload["evidence_scope"] = "仅依据 OpenAlex 检索元数据及可用摘要，尚未核验全文。"
    payload["search_cached"] = found["cached"]
    payload["search_fetched_at"] = found["fetched_at"]
    return save_artifact(owner, "novelty_analysis", [], payload)


@router.post("/novelty")
async def novelty(request: IdeaRequest, owner: str = Owner):
    return await execute_novelty(owner, request.query, timeout=NOVELTY_AI_TIMEOUT, fallback=True)


class DesignRequest(BaseModel):
    goal: str = Field(min_length=5, max_length=1500)
    constraints: str = Field(default="", max_length=1500)
    action: str = "generate"
    current_design: dict | None = None
    node_id: str | None = None
    instruction: str = Field(default="", max_length=1000)
    regenerate: bool = False


def quick_design(goal: str, constraints: str) -> dict:
    """A clearly labelled, domain-neutral draft when generation exceeds the UI budget."""
    nodes = [
        {"id": "N1", "label": "明确问题与假设", "type": "question", "detail": f"围绕“{goal}”写出可证伪的主假设，并明确研究对象、干预或暴露、主要结局。"},
        {"id": "N2", "label": "选择研究对象和资料", "type": "method", "detail": "确定适用的样本、数据或实验模型；记录纳入排除标准和资料来源。"},
        {"id": "N3", "label": "设置对照与测量", "type": "method", "detail": "确定合适的对照、主要评价指标和测量时间点，先检查可行性。"},
        {"id": "N4", "label": "检验与敏感性分析", "type": "validation", "detail": "验证主假设，并检查混杂、替代解释、批次差异或模型假设。"},
        {"id": "N5", "label": "解释证据边界", "type": "conclusion", "detail": "区分观察到的结果与因果推断，说明外推范围和仍需验证的问题。"},
    ]
    return Design.model_validate({"goal": goal,
        "change_summary": "快速设计草稿：模型解读未完成，以下为可立即编辑的通用研究框架；具体实验条件需结合领域文献核对。",
        "constraints": [constraints] if constraints.strip() else [], "nodes": nodes,
        "edges": [{"source": f"N{i}", "target": f"N{i+1}", "label": "下一步"} for i in range(1, 5)],
        "controls": ["根据研究对象设置可比的对照条件"],
        "readouts": ["预先定义主要结局及测量方法"],
        "assumptions": ["资料质量和样本可满足研究目标；具体参数待预实验或功效分析确定"]}).model_dump()


def design_changes(before: dict | None, after: dict) -> dict:
    old = {item["id"]: item for item in (before or {}).get("nodes", []) if "id" in item}
    new = {item["id"]: item for item in after["nodes"]}
    return {"added": [new[key]["label"] for key in new.keys() - old.keys()],
            "removed": [old[key]["label"] for key in old.keys() - new.keys()],
            "modified": [new[key]["label"] for key in new.keys() & old.keys() if new[key] != old[key]]}


def limit_node_revision(before: dict, after: dict, target: str) -> dict:
    try:
        original = Design.model_validate(before).model_dump()
    except ValidationError as exc:
        raise HTTPException(422, "当前设计数据无效，请重新生成方案") from exc
    old_nodes = {item["id"]: item for item in original["nodes"]}
    if target not in old_nodes:
        raise HTTPException(422, "请选择现有设计节点")
    downstream = {target}
    while True:
        expanded = downstream | {edge["target"] for edge in original["edges"] if edge["source"] in downstream}
        if expanded == downstream:
            break
        downstream = expanded
    generated = {item["id"]: item for item in after["nodes"]}
    after["nodes"] = [generated.get(item["id"], item) if item["id"] in downstream else item
                      for item in original["nodes"]]
    included = {item["id"] for item in after["nodes"]}
    unchanged_edges = [edge for edge in original["edges"]
                       if edge["source"] not in downstream and edge["target"] not in downstream]
    changed_edges = [edge for edge in after["edges"]
                     if edge["source"] in included and edge["target"] in included
                     and (edge["source"] in downstream or edge["target"] in downstream)]
    after["edges"] = unchanged_edges + changed_edges
    return after


def version_data(version: DesignVersion, artifact: ResearchArtifact) -> dict:
    return {"version_id": version.id, "number": version.version_number, "action": version.action,
            "parent_version_id": version.parent_version_id,
            "changes": json.loads(version.changed_nodes_json), "artifact_id": artifact.id,
            "payload": json.loads(artifact.payload_json), "created_at": version.created_at.isoformat()}


async def execute_design(owner: str, request: DesignRequest, *, emit=None,
                         timeout: float | None = None, fallback: bool = True) -> dict:
    actions = {"generate": "生成研究设计", "node": "局部优化节点", "causality": "加强因果识别", "cost": "降低成本",
               "simplify": "简化方案", "mechanism": "增加机制验证", "application": "增强临床或应用意义"}
    if request.action not in actions:
        raise HTTPException(422, "不支持的设计操作")
    if request.action == "node" and (not request.current_design or not request.node_id or not request.instruction.strip()):
        raise HTTPException(422, "请选择节点并输入修改要求")
    if request.action == "generate" and not request.regenerate:
        with SessionLocal() as db:
            workspace = get_or_create(db, owner)
            artifact = db.get(ResearchArtifact, workspace.design_version_id) if workspace.design_version_id else None
            if artifact and artifact.owner_id == owner and artifact.kind == "experiment_design":
                existing = json.loads(artifact.payload_json)
                if (existing.get("goal", "").strip() == request.goal.strip() and
                        existing.get("input_constraints", "") == request.constraints.strip()):
                    version = db.scalar(select(DesignVersion).where(
                        DesignVersion.owner_id == owner, DesignVersion.artifact_id == artifact.id))
                    if version:
                        return {"id": artifact.id, "kind": artifact.kind, "paper_ids": [],
                            "payload": existing, "created_at": artifact.created_at.isoformat(),
                            "version": version_data(version, artifact)}
    research_context = {}
    with SessionLocal() as db:
        workspace = get_or_create(db, owner)
        if workspace.design_idea.strip() == request.goal.strip():
            selected = json.loads(workspace.selected_paper_ids_json)
            papers = db.scalars(select(Paper).where(Paper.owner_id == owner, Paper.id.in_(selected))).all() if selected else []
            research_context = {
                "research_gap": workspace.research_gap[:1500],
                "synthesis_context": json.loads(workspace.gap_context_json),
                "selected_papers": [{"paper_id": item.id, "title": item.title,
                    "full_text_available": item.status == "parsed"} for item in papers],
                "evidence_note": "此处是前序综合输出和论文状态，不等于已独立核验的直接实验事实。",
            }
    if emit is not None:
        await emit("stage", {"stage": "designing", "label": "组织研究设计节点"})
    try:
        payload = await _run_task("experiment_design", {"goal": request.goal,
            "constraints": request.constraints, "request": actions[request.action],
            "current_design": request.current_design, "node_id": request.node_id,
            "node_instruction": request.instruction.strip(),
            "research_context": research_context}, emit, timeout=timeout)
    except (TimeoutError, StructuredAIError) as exc:
        if fallback and request.action == "generate":
            logger.warning("Design generation timed out or failed; returning quick draft: %s", type(exc).__name__)
            payload = quick_design(request.goal, request.constraints)
        else:
            logger.warning("Design AI failed: %s", type(exc).__name__)
            raise HTTPException(503, "本次调整未完成；原方案已保留，请稍后重试") from exc
    # 模型会用自己的话复述 goal。一旦复述版与用户原话不同，save_artifact 会把
    # workspace.design_idea 改写成复述版；紧接着 GET /api/workspace 的 prune_stale_idea_results
    # 发现 novelty payload 的 query 与 design_idea 不再相等，就把 novelty_id 静默清空——
    # 用户看到的是「生成设计后新颖性扫描结果消失」。这里强制回填用户原话，让三者始终同源。
    payload["goal"] = request.goal
    payload["input_constraints"] = request.constraints.strip()
    node_ids = {node["id"] for node in payload["nodes"]}
    payload["edges"] = [edge for edge in payload["edges"]
                        if edge["source"] in node_ids and edge["target"] in node_ids]
    if request.action == "node":
        payload = limit_node_revision(request.current_design or {}, payload, request.node_id or "")
    with SessionLocal() as db:
        workspace = get_or_create(db, owner)
        active_parent = db.scalar(select(DesignVersion).where(
            DesignVersion.owner_id == owner,
            DesignVersion.workspace_id == workspace.id,
            DesignVersion.artifact_id == workspace.design_version_id)) if workspace.design_version_id else None
        previous = db.scalar(select(DesignVersion).where(
            DesignVersion.owner_id == owner, DesignVersion.workspace_id == workspace.id
        ).order_by(DesignVersion.version_number.desc()))
        parent_id = active_parent.id if active_parent else None
        next_number = previous.version_number + 1 if previous else 1
        workspace_id = workspace.id
    artifact = save_artifact(owner, "experiment_design", [], payload)
    with SessionLocal() as db:
        version = DesignVersion(id=str(uuid4()), owner_id=owner, workspace_id=workspace_id,
            artifact_id=artifact["id"], version_number=next_number,
            parent_version_id=parent_id, action=request.action,
            changed_nodes_json=json.dumps(design_changes(request.current_design, payload), ensure_ascii=False))
        db.add(version)
        db.commit()
        artifact["version"] = version_data(version, db.get(ResearchArtifact, artifact["id"]))
    return artifact


@router.post("/design")
async def design(request: DesignRequest, owner: str = Owner):
    try:
        return await execute_design(owner, request, timeout=DESIGN_AI_TIMEOUT, fallback=True)
    except TimeoutError as exc:
        raise HTTPException(504, "研究设计超过等待上限，请稍后重试") from exc


@router.get("/design/versions")
def design_versions(artifact_id: str | None = None, goal: str | None = None, owner: str = Owner):
    with SessionLocal() as db:
        workspace = get_or_create(db, owner)
        query = select(DesignVersion).where(
            DesignVersion.owner_id == owner, DesignVersion.workspace_id == workspace.id)
        # 默认只回最近 20 条（版本历史列表）。但 workspace.design_version_id 可能指向更老的版本，
        # 前端据此还原沙盘时会在 20 条里找不到 → 画布空白。允许按 artifact_id 精确取那一条。
        if artifact_id:
            query = query.where(DesignVersion.artifact_id == artifact_id)
        rows = db.scalars(query.order_by(DesignVersion.version_number.desc()).limit(1 if artifact_id else 200)).all()
        result = []
        for row in rows:
            artifact = db.get(ResearchArtifact, row.artifact_id)
            if goal is not None and not artifact_id and json.loads(artifact.payload_json).get("goal", "").strip() != goal.strip():
                continue
            result.append(version_data(row, artifact))
            if len(result) == (1 if artifact_id else 20):
                break
        return result


@router.post("/design/versions/{version_id}/restore")
def restore_design_version(version_id: str, owner: str = Owner):
    with SessionLocal() as db:
        version = db.scalar(select(DesignVersion).where(
            DesignVersion.id == version_id, DesignVersion.owner_id == owner))
        if not version:
            raise HTTPException(404, "设计版本不存在")
        workspace = get_or_create(db, owner)
        if version.workspace_id != workspace.id:
            raise HTTPException(404, "设计版本不存在")
        artifact = db.get(ResearchArtifact, version.artifact_id)
        workspace.design_version_id = artifact.id
        db.commit()
        return version_data(version, artifact)


@router.get("/artifacts")
def list_artifacts(kind: str | None = None, artifact_id: str | None = None, owner: str = Owner):
    with SessionLocal() as db:
        query = select(ResearchArtifact).where(ResearchArtifact.owner_id == owner)
        if kind:
            query = query.where(ResearchArtifact.kind == kind)
        # 默认只回最近 30 条。workspace 里的指针（novelty_id / synthesis_id）可能更老，
        # 前端按 id 在 30 条里找不到就当成「结果丢了」——正是要避免的那种静默失效。
        if artifact_id:
            query = query.where(ResearchArtifact.id == artifact_id)
        items = db.scalars(query.order_by(ResearchArtifact.created_at.desc()).limit(1 if artifact_id else 30)).all()
        return [{"id": item.id, "kind": item.kind,
                 "paper_ids": json.loads(item.paper_ids_json),
                 "payload": json.loads(item.payload_json),
                 "created_at": item.created_at.isoformat()} for item in items]
