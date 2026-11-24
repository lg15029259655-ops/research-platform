"""论文实验导图：梳理论文实际做了哪些实验、先后关系与证据链。

与"实验设计图"（第四部分，面向未来方案）不同，这里只提取论文里**真实出现**的实验：
方法章节里的实验步骤 → 结果/图表里的证据。AI 可用时由模型抽取；不可用时用关键词规则，
保证无 Key 也能给出可核对的基础版本。
"""

import asyncio
import logging
import re
from sqlalchemy import select

from ..db import SessionLocal
from ..models import Paper, ReadingUnit
from .experiment_service import CATEGORY_NAMES
from .mindmap_service import find_saved_map, parse_revision
from .prepared_paper_experiments import prepared_experiments
from .research_ai import EXPERIMENT_CATEGORY_IDS

logger = logging.getLogger(__name__)

MAX_EXPERIMENTS = 16
MAX_METHODS = 4
MAX_EVIDENCE = 3
EXPERIMENT_CACHE_SUFFIX = ":evidence-v5"
MAX_TITLE = 24
MAX_RESULT = 150

# (category, 展示用短标签, 中英文关键词)。顺序即匹配优先级：更具体的检测/建模放前面，
# 宽泛的"细胞/分析"放后面，避免"细胞增殖实验"被笼统归到 analysis。
_KEYWORDS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("molecular_experiment", "Western blot", ("western blot", "western", "免疫印迹")),
    ("molecular_experiment", "qPCR", ("qpcr", "pcr", "实时定量")),
    ("molecular_experiment", "免疫组化", ("免疫组化", "ihc", "immunohistochem")),
    ("molecular_experiment", "ELISA", ("elisa",)),
    ("molecular_experiment", "质谱", ("质谱", "mass spectrom")),
    ("molecular_experiment", "免疫共沉淀", ("co-ip", "coimmunoprecipitation", "co-immunoprecipitation", "免疫共沉淀")),
    ("molecular_experiment", "染色质免疫沉淀", ("chip-seq", "chip-qpcr", "chromatin immunoprecipitation", "染色质免疫沉淀")),
    ("molecular_experiment", "报告基因检测", ("luciferase", "reporter assay", "报告基因")),
    ("data_analysis", "单细胞分析", ("单细胞", "single-cell", "single cell")),
    ("data_analysis", "转录组测序", ("转录组", "rna-seq", "rnaseq", "sequencing", "测序")),
    ("data_analysis", "差异表达分析", ("差异表达", "差异基因", "differential expression")),
    ("data_analysis", "富集分析", ("富集分析", "enrichment")),
    ("data_analysis", "数据库筛选", ("数据库", "geo", "tcga", "gtex", "public dataset")),
    ("cell_experiment", "细胞培养", ("细胞培养", "cell culture", "cell lines were grown")),
    ("cell_experiment", "细胞转染", ("转染", "transfect")),
    ("cell_experiment", "敲低/敲除", ("敲低", "敲除", "knockdown", "knockout", "sirna", "shrna", "crispr")),
    ("cell_experiment", "过表达", ("过表达", "overexpress")),
    ("cell_experiment", "增殖/凋亡检测", ("增殖检测", "凋亡检测", "cck-8", "cck8", "apoptosis assay", "proliferation assay", "viability assay")),
    ("cell_experiment", "克隆形成", ("colony formation", "clonogenic assay", "克隆形成")),
    ("cell_experiment", "类器官实验", ("organoid", "类器官")),
    ("cell_experiment", "迁移/侵袭实验", ("迁移实验", "侵袭实验", "transwell", "migration assay", "invasion assay")),
    ("cell_experiment", "共培养", ("共培养", "co-culture", "coculture")),
    ("cell_experiment", "流式细胞术", ("流式", "flow cytometry")),
    ("animal_experiment", "动物模型构建", ("动物模型", "小鼠", "大鼠", "裸鼠", "mouse", "mice", "rat", "rats", "xenograft")),
    ("animal_experiment", "给药处理", ("给药", "灌胃", "腹腔注射", "dosing", "administration")),
    ("animal_experiment", "组织病理分析", ("he 染色", "组织病理", "histopathologic analysis", "histological analysis", "hematoxylin and eosin")),
    ("animal_experiment", "活体成像", ("活体成像", "in vivo imaging", "bioluminescence")),
    ("clinical_sample", "临床样本", ("临床样本", "患者样本", "组织芯片", "human liver tissue specimens", "patient samples", "tissue microarray")),
    ("imaging", "共聚焦成像", ("共聚焦", "confocal", "荧光成像")),
    ("imaging", "电镜", ("电镜", "electron microscop")),
    ("survey_statistics", "生存分析", ("kaplan-meier", "cox regression", "生存分析")),
    ("modeling_algorithm", "消融实验", ("ablation study", "消融实验")),
    ("materials_prep", "材料表征", ("x-ray diffraction", "scanning electron microscopy", "材料表征")),
)

_SENTENCE = re.compile(r"(?<=[。！？!?；;])|(?<=[.])\s+")
_OUTCOME_SECTIONS = {"RESULTS", "FIGURE", "TABLE"}
_OUTCOME_CUE = re.compile(r"\b(?:show\w*|observ\w*|found|detect\w*|reveal\w*|measur\w*|increas\w*|decreas\w*|reduc\w*|suppress\w*|quantif\w*|confirm\w*)\b|显示|观察|检测|发现|增加|降低|抑制", re.I)
_BROAD_METHODS = {"敲低/敲除", "过表达", "给药处理", "动物模型构建", "临床样本", "数据库筛选"}
_REVIEW_CUE = re.compile(r"\b(?:in this review|this (?:systematic |scoping |narrative )?review|we review|meta-analysis)\b|本文综述|本综述", re.I)
_ATTRIBUTION = re.compile(r"\[\s*\d+(?:[\d\s,–-]*\d)?\s*\]|\bet al\b|\b(?:a|one|previous|recent) stud(?:y|ies)\b|研究发现|有研究|已有研究", re.I)


def _clip(text: str, limit: int) -> str:
    text = _clean(text)
    return text if len(text) <= limit else text[: max(1, limit - 1)].rstrip() + "…"


def _clean(value: str | None) -> str:
    text = re.sub(r"\[[0-9,\s\-–]+\]", " ", value or "")
    return re.sub(r"\s+", " ", text).strip()


def _sentences(text: str | None) -> list[str]:
    cleaned = _clean(text)
    return [part.strip() for part in _SENTENCE.split(cleaned) if part and part.strip()]


def _matches(text: str) -> list[tuple[str, str]]:
    lowered = text.casefold()
    hits = []
    for category, label, patterns in _KEYWORDS:
        if any((re.search(r"(?<![a-z0-9])" + re.escape(pattern) + r"(?![a-z0-9])", lowered) is not None)
               if pattern.isascii() and pattern.isalnum() and len(pattern) <= 4
               else pattern in lowered for pattern in patterns):
            hits.append((category, label))
    return hits


def _match(text: str) -> tuple[str, str] | None:
    hits = _matches(text)
    return hits[0] if hits else None


def _evidence(unit: ReadingUnit, snippet: str, label: str) -> dict:
    text = _clean(snippet)
    patterns = next((patterns for _, name, patterns in _KEYWORDS if name == label), ())
    positions = [text.casefold().find(pattern) for pattern in patterns if text.casefold().find(pattern) >= 0]
    position = min(positions) if positions else 0
    start = max(0, position - 35)
    return {"unit_id": unit.id, "page": unit.page_start, "page_end": unit.page_end,
            "snippet": text[start:start + 120]}



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
        if title not in existing["methods"] and len(existing["methods"]) < MAX_METHODS:
            existing["methods"].append(title)
        evidence = _evidence(unit, sentence, title)
        limit = MAX_EVIDENCE if result else MAX_EVIDENCE - 1
        if len(existing["evidence"]) < limit and evidence not in existing["evidence"]:
            existing["evidence"].append(evidence)
        return existing

    for unit in ordered:
        kind = unit.kind
        if kind in ("METHODS",):
            for sentence in _sentences(unit.source_text):
                for category, label in _matches(sentence):
                    add(category, label, unit, sentence, result=False)

    # A result sentence can support a named technique independently of whether
    # its subsection survived PDF parsing. Do not attach by category alone.
    for unit in sorted(ordered, key=lambda item: item.kind == "RESULTS"):
        if unit.kind not in _OUTCOME_SECTIONS:
            continue
        for sentence in _sentences(unit.source_text):
            if not _OUTCOME_CUE.search(sentence):
                continue
            hits = [(category, label) for category, label in _matches(sentence) if label not in _BROAD_METHODS]
            if len(hits) == 1:
                category, label = hits[0]
                if label not in by_title or not by_title[label]["result"]:
                    add(category, label, unit, sentence, result=True)

    experiments = experiments[:MAX_EXPERIMENTS]
    for index, item in enumerate(experiments):
        item["order"] = index + 1
        item["id"] = f"E{index + 1}"
        item["depends_on"] = []
        item["methods"] = [method[:16] for method in item["methods"][:MAX_METHODS]]
        item["inferred"] = bool(item["inferred"] or not item["evidence"])
    return experiments


def _is_review(paper: Paper, units: list[ReadingUnit]) -> bool:
    if paper.study_type == "evidence_synthesis":
        return True
    abstract = next((unit.source_text for unit in units if unit.kind == "ABSTRACT"), "") or ""
    if any(unit.kind in {"METHODS", "RESULTS"} for unit in units):
        return False
    return bool(_REVIEW_CUE.search(" ".join((paper.title or "", paper.abstract or "", abstract[:2000]))))


def _review_experiments(units: list[ReadingUnit]) -> list[dict]:
    experiments = []
    seen = set()
    for unit in units:
        if unit.kind not in {"ABSTRACT", "INTRODUCTION", "BODY", "RESULTS", "DISCUSSION", "CONCLUSION"}:
            continue
        source = re.sub(r"\bet al\.", "et al", unit.source_text or "", flags=re.I)
        for sentence in _SENTENCE.split(source):
            if not _ATTRIBUTION.search(sentence) or not _OUTCOME_CUE.search(sentence):
                continue
            for category, label in _matches(sentence):
                if label in seen:
                    continue
                seen.add(label)
                order = len(experiments) + 1
                experiments.append({
                    "id": f"E{order}", "order": order, "title": label, "category": category,
                    "methods": [label], "result": _clip(sentence, MAX_RESULT),
                    "evidence": [_evidence(unit, sentence, label)], "depends_on": [], "inferred": True,
                })
                break
            if len(experiments) >= MAX_EXPERIMENTS:
                return experiments
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
        evidence = []
        for ref in item.get("evidence", []) if isinstance(item.get("evidence"), list) else []:
            if not isinstance(ref, dict):
                continue
            unit = by_id.get(str(ref.get("unit_id", "")))
            if unit is None:
                continue
            snippet = str(ref.get("snippet", "")).strip()
            normalize = lambda value: re.sub(r"\s+", " ", value).strip().casefold()
            if len(normalize(snippet)) < 12 or normalize(snippet) not in normalize(unit.source_text or ""):
                continue
            evidence.append({"unit_id": unit.id, "page": unit.page_start, "page_end": unit.page_end,
                             "snippet": snippet[:120]})
            if len(evidence) >= MAX_EVIDENCE:
                break
        if not evidence:
            continue
        seen_titles.add(title)
        method_values = item.get("methods")
        methods = []
        if isinstance(method_values, list):
            methods = [value.strip()[:16] for value in method_values
                       if isinstance(value, str) and value.strip()][:MAX_METHODS]
        evidence_kinds = {by_id[ref["unit_id"]].kind for ref in evidence}
        result = _clip(str(item.get("result", "")), MAX_RESULT) if evidence_kinds & {"RESULTS", "FIGURE", "TABLE"} else ""
        cleaned.append({
            "id": f"E{len(cleaned) + 1}", "order": len(cleaned) + 1, "title": title, "category": category,
            "methods": methods, "result": result, "evidence": evidence,
            "depends_on": [], "inferred": True,
        })
        if len(cleaned) >= MAX_EXPERIMENTS:
            break
    return cleaned


def _ai_context(paper: Paper, units: list[ReadingUnit]) -> dict:
    # Reserve capacity for figures even when the results or methods are long.
    # A bounded sample is not the full paper; downstream must retain that caveat.
    excerpts = []
    ordered = sorted(units, key=lambda item: item.position)
    for kinds, limit in (({"METHODS"}, 10), ({"RESULTS", "CONCLUSION"}, 8), ({"FIGURE", "TABLE"}, 6)):
        bucket = []
        for unit in ordered:
            if unit.kind not in kinds:
                continue
            text = re.sub(r"\s+", " ", unit.source_text or "").strip()
            for start in range(0, len(text), 1600):
                bucket.append({"unit_id": unit.id, "kind": unit.kind,
                               "page": unit.page_start, "text": text[start:start + 1600]})
                if len(bucket) >= limit:
                    break
            if len(bucket) >= limit:
                break
        excerpts.extend(bucket)
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
        revision = parse_revision(paper, units) + EXPERIMENT_CACHE_SUFFIX
        cached = find_saved_map(db, owner, paper_id, "paper_experiments", revision)
        if cached is not None:
            return cached
        expected_revision = (paper.content_revision, paper.sha256)
        title = paper.title
        context = _ai_context(paper, units)
        prepared = prepared_experiments(paper, revision)
        cited = _is_review(paper, units)

    if prepared is not None:
        return save_artifact(owner, "paper_experiments", [paper_id], prepared,
                             expected_revisions={paper_id: expected_revision})
    if cited:
        payload = {
            "paper_id": paper_id, "parse_revision": revision, "cited": True, "generated_by": "rules",
            "summary": "从综述中提取可定位的引用实验线索。页码指向综述原文。",
            "experiments": _review_experiments(units),
        }
        return save_artifact(owner, "paper_experiments", [paper_id], payload,
                             expected_revisions={paper_id: expected_revision})

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

    rule_candidates = rules_experiments(units)
    if experiments:
        ai_count = len(experiments)
        represented = {hit for item in experiments
                       for hit in _matches(" ".join([item["title"], *item["methods"]]))}
        for candidate in rule_candidates:
            if len(experiments) >= MAX_EXPERIMENTS:
                break
            key = (candidate["category"], candidate["title"])
            if key in represented:
                continue
            candidate["id"] = f"E{len(experiments) + 1}"
            candidate["order"] = len(experiments) + 1
            experiments.append(candidate)
            represented.add(key)
            if len(experiments) >= MAX_EXPERIMENTS:
                break
        generated_by = "ai_and_rules" if len(experiments) > ai_count else "ai"
    else:
        experiments = rule_candidates

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
