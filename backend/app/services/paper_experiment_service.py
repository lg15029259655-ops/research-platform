"""论文实验导图：梳理论文实际做了哪些实验、先后关系与证据链。

与"实验设计图"（第四部分，面向未来方案）不同，这里只提取论文里**真实出现**的实验：
方法章节里的实验步骤 → 结果/图表里的证据。AI 可用时由模型抽取；不可用时用关键词规则，
保证无 Key 也能给出可核对的基础版本。
"""

import asyncio
import json
import logging
import re
from sqlalchemy import select

from ..db import SessionLocal
from ..models import Paper, ReadingUnit, ResearchArtifact
from .experiment_service import CATEGORY_NAMES
from .mindmap_service import parse_revision
from .research_ai import EXPERIMENT_CATEGORY_IDS

logger = logging.getLogger(__name__)

MAX_EXPERIMENTS = 8
MAX_METHODS = 4
MAX_EVIDENCE = 3
MAX_TITLE = 24
MAX_RESULT = 60

# (category, 展示用短标签, 中英文关键词)。顺序即匹配优先级：更具体的检测/建模放前面，
# 宽泛的"细胞/分析"放后面，避免"细胞增殖实验"被笼统归到 analysis。
_KEYWORDS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("molecular_experiment", "Western blot", ("western blot", "western", "免疫印迹")),
    ("molecular_experiment", "qPCR", ("qpcr", "pcr", "实时定量")),
    ("molecular_experiment", "免疫组化", ("免疫组化", "ihc", "immunohistochem")),
    ("molecular_experiment", "ELISA", ("elisa",)),
    ("molecular_experiment", "质谱", ("质谱", "mass spectrom")),
    ("data_analysis", "单细胞分析", ("单细胞", "single-cell", "single cell")),
    ("data_analysis", "转录组测序", ("转录组", "rna-seq", "rnaseq", "sequencing", "测序")),
    ("data_analysis", "差异表达分析", ("差异表达", "差异基因", "differential expression")),
    ("data_analysis", "富集分析", ("富集分析", "enrichment")),
    ("data_analysis", "数据库筛选", ("数据库", "geo", "tcga", "gtex", "public dataset")),
    ("cell_experiment", "细胞培养与转染", ("细胞培养", "培养", "传代", "转染", "transfect", "cell culture")),
    ("cell_experiment", "敲低/敲除", ("敲低", "敲除", "knockdown", "knockout", "sirna", "shrna", "crispr")),
    ("cell_experiment", "过表达", ("过表达", "overexpress")),
    ("cell_experiment", "增殖/凋亡检测", ("增殖", "凋亡", "cck-8", "cck8", "apoptosis", "proliferation", "viability")),
    ("cell_experiment", "迁移/侵袭实验", ("迁移", "侵袭", "transwell", "migration", "invasion")),
    ("cell_experiment", "共培养", ("共培养", "co-culture", "coculture")),
    ("cell_experiment", "流式细胞术", ("流式", "flow cytometry")),
    ("animal_experiment", "动物模型构建", ("动物模型", "小鼠", "大鼠", "裸鼠", "mouse", "mice", "rat", "rats", "xenograft")),
    ("animal_experiment", "给药处理", ("给药", "灌胃", "腹腔注射", "dosing", "administration")),
    ("animal_experiment", "组织取材与切片", ("取材", "切片", "he 染色", "组织学", "histolog")),
    ("animal_experiment", "活体成像", ("活体成像", "in vivo imaging", "bioluminescence")),
    ("clinical_sample", "临床样本", ("患者", "病人", "临床样本", "组织芯片", "patient", "cohort", "tissue microarray")),
    ("imaging", "共聚焦成像", ("共聚焦", "confocal", "荧光成像")),
    ("imaging", "电镜", ("电镜", "electron microscop")),
    ("materials_prep", "材料合成与表征", ("合成", "制备", "sem", "xrd", "表征", "synthesis", "characteriz")),
    ("engineering_test", "仿真/样机测试", ("有限元", "仿真", "样机", "台架", "simulation", "prototype")),
    ("modeling_algorithm", "模型训练与评估", ("模型训练", "基线", "消融", "基准", "泛化", "benchmark", "ablation", "neural network")),
    ("survey_statistics", "问卷与统计", ("问卷", "量表", "回归", "调查", "survey", "questionnaire")),
)

_SENTENCE = re.compile(r"(?<=[。！？!?；;])|(?<=[.])\s+")


def _clip(text: str, limit: int) -> str:
    text = _clean(text)
    return text if len(text) <= limit else text[: max(1, limit - 1)].rstrip() + "…"


def _clean(value: str | None) -> str:
    text = re.sub(r"\[[0-9,\s\-–]+\]", " ", value or "")
    return re.sub(r"\s+", " ", text).strip()


def _sentences(text: str | None) -> list[str]:
    cleaned = _clean(text)
    return [part.strip() for part in _SENTENCE.split(cleaned) if part and part.strip()]


def _match(text: str) -> tuple[str, str] | None:
    lowered = text.casefold()
    for category, label, patterns in _KEYWORDS:
        if any((re.search(r"(?<![a-z0-9])" + re.escape(pattern) + r"(?![a-z0-9])", lowered) is not None)
               if pattern.isascii() and pattern.isalnum() and len(pattern) <= 4
               else pattern in lowered for pattern in patterns):
            return category, label
    return None


def _evidence(unit: ReadingUnit, snippet: str) -> dict:
    return {"unit_id": unit.id, "page": unit.page_start, "snippet": _clean(snippet)[:120]}


def rules_experiments(units: list[ReadingUnit]) -> list[dict]:
    """从方法与结果句子中提取实验链；无 AI 时的主路径，也是 AI 失败时的兜底。"""
    ordered = sorted(units, key=lambda item: item.position)
    experiments: list[dict] = []
    by_title: dict[str, dict] = {}
    order = 0

    def add(category: str, title: str, unit: ReadingUnit, sentence: str, *, result: bool) -> dict:
        nonlocal order
        existing = by_title.get(title)
        if existing is None:
            order += 1
            existing = {
                "id": f"E{order}", "order": order, "title": title[:MAX_TITLE],
                "category": category if category in CATEGORY_NAMES else "result_conclusion",
                "methods": [], "result": "", "evidence": [], "depends_on": [],
                "inferred": not result,
            }
            experiments.append(existing)
            by_title[title] = existing
        if result:
            if not existing["result"]:
                existing["result"] = _clip(sentence, MAX_RESULT)
            existing["inferred"] = True
        else:
            if title not in existing["methods"] and len(existing["methods"]) < MAX_METHODS:
                existing["methods"].append(title)
        if len(existing["evidence"]) < MAX_EVIDENCE:
            existing["evidence"].append(_evidence(unit, sentence))
        return existing

    for unit in ordered:
        kind = unit.kind
        if kind in ("METHODS",):
            for sentence in _sentences(unit.source_text):
                hit = _match(sentence)
                if hit:
                    add(hit[0], hit[1], unit, sentence, result=False)
        elif kind in ("RESULTS",):
            for sentence in _sentences(unit.source_text):
                hit = _match(sentence)
                if hit:
                    add(hit[0], hit[1], unit, sentence, result=True)
        elif kind in ("FIGURE", "TABLE"):
            caption = _sentences(unit.source_text)
            text = caption[0] if caption else unit.heading
            hit = _match(text)
            if hit:
                add(hit[0], hit[1], unit, text, result=False)

    experiments = experiments[:MAX_EXPERIMENTS]
    for index, item in enumerate(experiments):
        item["order"] = index + 1
        item["id"] = f"E{index + 1}"
        item["depends_on"] = []
        item["methods"] = [method[:16] for method in item["methods"][:MAX_METHODS]]
        item["inferred"] = bool(item["inferred"] or not item["evidence"])
    return experiments


def _summary(experiments: list[dict]) -> str:
    titles = "、".join(item["title"] for item in experiments[:6])
    return f"共 {len(experiments)} 项候选实验：{titles}"[:120]


def _validate_ai(payload: dict, units: list[ReadingUnit]) -> list[dict]:
    """AI 结果必须落到真实单元与合法分类上，否则丢弃。"""
    by_id = {unit.id: unit for unit in units}
    cleaned: list[dict] = []
    seen_titles: set[str] = set()
    for item in payload.get("experiments", []):
        if not isinstance(item, dict):
            continue
        title = _clean(str(item.get("title", "")))[:MAX_TITLE]
        category = str(item.get("category", "")).strip()
        if not title or category not in EXPERIMENT_CATEGORY_IDS or title in seen_titles:
            continue
        seen_titles.add(title)
        evidence = []
        for ref in item.get("evidence", []) if isinstance(item.get("evidence"), list) else []:
            unit = by_id.get(str(ref.get("unit_id", "")))
            if unit is None:
                continue
            snippet = str(ref.get("snippet", "")).strip()
            normalize = lambda value: re.sub(r"\s+", " ", value).strip().casefold()
            if len(normalize(snippet)) < 12 or normalize(snippet) not in normalize(unit.source_text or ""):
                continue
            evidence.append({"unit_id": unit.id, "page": unit.page_start, "snippet": snippet[:120]})
            if len(evidence) >= MAX_EVIDENCE:
                break
        if not evidence:
            continue
        methods = [str(value)[:16] for value in (item.get("methods") or []) if str(value).strip()][:MAX_METHODS]
        result = _clip(str(item.get("result", "")), MAX_RESULT)
        cleaned.append({
            "id": f"E{len(cleaned) + 1}", "order": len(cleaned) + 1, "title": title, "category": category,
            "methods": methods, "result": result, "evidence": evidence,
            "depends_on": [], "inferred": True,
        })
        if len(cleaned) >= MAX_EXPERIMENTS:
            break
    for index, item in enumerate(cleaned):
        item["depends_on"] = []
    return cleaned


def _existing_artifact(owner: str, paper_id: str, revision: str) -> dict | None:
    with SessionLocal() as db:
        rows = db.scalars(select(ResearchArtifact).where(
            ResearchArtifact.owner_id == owner,
            ResearchArtifact.kind == "paper_experiments",
        ).order_by(ResearchArtifact.created_at.desc())).all()
        for row in rows:
            if json.loads(row.paper_ids_json) != [paper_id]:
                continue
            payload = json.loads(row.payload_json)
            if payload.get("parse_revision") == revision:
                return {"id": row.id, "kind": row.kind, "paper_ids": [paper_id],
                        "payload": payload, "created_at": row.created_at.isoformat()}
    return None


def _ai_context(paper: Paper, units: list[ReadingUnit]) -> dict:
    excerpts = []
    for unit in sorted(units, key=lambda item: item.position):
        if unit.kind not in ("METHODS", "RESULTS", "FIGURE", "TABLE", "CONCLUSION"):
            continue
        excerpts.append({
            "unit_id": unit.id,
            "kind": unit.kind,
            "page": unit.page_start,
            "text": _clean(unit.source_text)[:900],
        })
        if len(excerpts) >= 18:
            break
    return {
        "paper_title": paper.title,
        "categories": [{"id": cid, "name": CATEGORY_NAMES[cid]} for cid in EXPERIMENT_CATEGORY_IDS],
        "units": excerpts,
    }


async def execute_paper_experiments(owner: str, paper_id: str, *, emit=None,
                                    timeout: float | None = None) -> dict:
    from ..research import save_artifact
    from ..papers import paper_source_matches

    with SessionLocal() as db:
        paper = db.scalar(select(Paper).where(Paper.id == paper_id, Paper.owner_id == owner))
        if paper is None:
            raise LookupError("论文不存在")
        if paper.status != "parsed" or not paper_source_matches(paper):
            raise ValueError("论文正在解析或 PDF 与阅读内容不一致，请先完成识别")
        units = db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id == paper_id)
                           .order_by(ReadingUnit.position)).all()
        if not units:
            raise ValueError("这篇论文还没有可用的阅读单元，请先完成解析")
        revision = parse_revision(paper, units) + ":evidence-v2"
        expected_revision = (paper.content_revision, paper.sha256)
        title = paper.title
        context = _ai_context(paper, units)

    cached = _existing_artifact(owner, paper_id, revision)
    if cached is not None:
        return cached

    if emit is not None:
        await emit("stage", {"stage": "reading", "label": "读取方法与结果单元"})

    experiments: list[dict] = []
    generated_by = "rules"
    if emit is not None:
        await emit("stage", {"stage": "extracting", "label": "提取论文中的实验"})
    try:
        from . import research_ai
        if generate_ai := getattr(research_ai, "run_task_events", None):
            result = await (asyncio.wait_for(generate_ai("paper_experiments_extract", context), timeout=timeout)
                            if timeout else generate_ai("paper_experiments_extract", context))
        else:
            result = await (asyncio.wait_for(research_ai.run_task("paper_experiments_extract", context), timeout=timeout)
                            if timeout else research_ai.run_task("paper_experiments_extract", context))
        experiments = _validate_ai(result or {}, units)
        if experiments:
            generated_by = "ai"
    except Exception as exc:  # noqa: BLE001 - AI 不可用是常态：规则提取兜底
        logger.warning("Paper experiments AI failed, using rules: %s", type(exc).__name__)

    if not experiments:
        experiments = rules_experiments(units)

    if emit is not None:
        await emit("stage", {"stage": "validating", "label": "校验证据单元"})
    payload = {
        "paper_id": paper_id,
        "parse_revision": revision,
        "summary": f"{title[:40]}：" + _summary(experiments) if title else _summary(experiments),
        "experiments": experiments,
        "generated_by": generated_by,
    }
    return save_artifact(owner, "paper_experiments", [paper_id], payload,
                         expected_revisions={paper_id: expected_revision})
