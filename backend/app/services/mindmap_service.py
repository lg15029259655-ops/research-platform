"""精读思维导图：确定性章节骨架 + AI 只负责"补关键点"。

为什么两段式：
- 纯 AI 生成整棵树，结构容易漏章节、顺序乱、层级不稳；
- 纯规则生成，只有标题没有洞见。
所以骨架完全由解析结果决定（0 成本、可复现），AI 只在骨架上补 label/类型/证据引用，
后端再逐条校验 unit_id 是否真实存在。AI 失败时退回骨架，不报 504。
"""

import asyncio
import hashlib
import json
import logging
import re
from typing import Any

from sqlalchemy import select

from ..db import SessionLocal
from ..models import Paper, ReadingUnit, ResearchArtifact
from .research_ai import StructuredAIError

logger = logging.getLogger(__name__)

# 精读单元 kind 的叙事顺序；RECAP 是全文复盘，不进导图。
_SECTION_ORDER = ("ABSTRACT", "INTRODUCTION", "METHODS", "RESULTS", "DISCUSSION", "CONCLUSION")
_SECTION_LABEL = {
    "ABSTRACT": "摘要", "INTRODUCTION": "研究背景", "METHODS": "方法",
    "RESULTS": "结果", "DISCUSSION": "讨论", "CONCLUSION": "结论", "EVIDENCE": "图表证据",
    "BODY": "正文", "UNCLASSIFIED": "未分类正文",
}
MAX_NODES = 120
MAX_POINTS_PER_SECTION = 4  # 每章节最多 6 个句子级要点：再多了导图过高、一屏看不全
MAX_EVIDENCE_POINTS = 3  # 图表证据单独成点，最多 4 个（够定位主图/主表）
POINT_LABEL_CHARS = 28
POINT_DETAIL_CHARS = 80


def _slug(text: str, fallback: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", text).strip("-")[:40]
    return cleaned or fallback


def parse_revision(paper: Paper, units: list[ReadingUnit]) -> str:
    """导图缓存版本：PDF 内容 + 单元结构变了才重算（改阅读进度不会触发）。"""
    digest = hashlib.sha256()
    for value in [paper.sha256, paper.title or "", *(
        json.dumps([unit.id, unit.position, unit.kind, unit.heading, unit.page_start,
                    unit.page_end, unit.source_text], ensure_ascii=False)
        for unit in units
    )]:
        digest.update(value.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()[:16]


def _node(node_id: str, label: str, kind: str, units: list[ReadingUnit], *,
          inferred: bool = False, children: list[dict] | None = None,
          detail: str = "") -> dict:
    first = units[0] if units else None
    return {
        "id": node_id,
        "label": _clean_text(label),
        "kind": kind,
        "unit_ids": [unit.id for unit in units][:6],
        "page": first.page_start if first else None,
        "inferred": inferred,
        "detail": _clean_text(detail),
        "children": children or [],
    }


def _clip(text: str, limit: int) -> str:
    """按字数截断并补省略号：导图里出现"半句被硬切"读起来像 bug。"""
    text = _clean_text(text)
    if len(text) <= limit:
        return text
    return text[: max(1, limit - 1)].rstrip() + "…"


def _clean_text(value: str | None) -> str:
    """去掉引用标记与多余空白：导图标签要短，"[12]" 这类标记只会占宽度。"""
    text = re.sub(r"\[[0-9,\s\-–]+\]", " ", value or "")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", text)
    return text.strip()


def _sentences(text: str | None) -> list[str]:
    """按中英文句末标点切句；不用 NLP，够用来给每个 point 取首句/第二句。"""
    cleaned = _clean_text(text)
    if not cleaned:
        return []
    parts = re.split(r"(?<=[。！？!?；;])|(?<=[.])\s+", cleaned)
    return [part.strip() for part in parts if part and part.strip()]


def _label_detail(unit: ReadingUnit) -> tuple[str, str]:
    """point 标签 = 首句的第一个短句（名词短语风格），detail = 完整首句/第二句。

    心智导图的节点应当是一个短语而不是整句：直接放整句会让节点变成小段落、导图密集难读。
    这里按逗号/分号/破折号切出第一小句（不做字符截断，因此不会出现省略号）；
    完整信息放到 detail，由前端在点击抽屉里展示。
    """
    sentences = _sentences(unit.source_text)
    first = sentences[0] if sentences else _clean_text(unit.heading)
    if not first:
        first = f"第 {unit.position + 1} 段"
    clauses = [part.strip() for part in re.split(r"[，,；;、—–]", first) if part.strip()]
    label = clauses[0] if clauses else first
    # 第一小句太短（例如 "1.1." / "However"）时，用前两个小句拼成可读短语。
    if len(label) < 8 and len(clauses) > 1:
        label = f"{clauses[0]}{clauses[1]}"
    detail = first if len(first) > len(label) else (sentences[1] if len(sentences) > 1 else first)
    label = re.sub(r"[。！？；;，,、：:]+$", "", label).strip()
    return label, detail


def _figure_label(unit: ReadingUnit) -> tuple[str, str]:
    """图表 point：短标题做 label，图注正文做 detail；兼容“Figure 1 / 图 1 / 图注/表注”几种解析结果。"""
    def strip_prefix(text: str) -> str:
        text = re.sub(r"^(?:图注/表注|图注|表注)[：:]\s*", "", text).strip()
        return text.strip()

    heading = strip_prefix(_clean_text(unit.heading) or "")
    match = re.match(r"^(?:fig(?:ure)?|图|table|表)\s*([0-9]+[A-Za-z]?)", heading, re.I)
    cn_prefix = None
    if match:
        cn_prefix = ("表" if re.match(r"^(?:table|表)", heading, re.I) else "图") + f" {match.group(1)}"

    raw_lines = [line.strip() for line in (unit.source_text or "").splitlines() if line.strip()]
    title = strip_prefix(_clean_text(raw_lines[0])) if raw_lines else heading
    body = " ".join(raw_lines[1:]) if len(raw_lines) > 1 else ""
    if not body:
        cleaned = strip_prefix(_clean_text(unit.source_text))
        body = cleaned
        if cleaned.startswith(title):
            body = cleaned[len(title):].strip(" ：:，,")
    # 首行本身可能已经带“图 1：”，去掉重复前缀
    title = re.sub(r"^(?:fig(?:ure)?|图|table|表)\s*[0-9]+[A-Za-z]?\s*[.:：、-]\s*", "", title, flags=re.I).strip()
    title = re.sub(r"[。！？；;，,、：:]+$", "", title).strip()
    # 标题与说明常常被解析器挤成一行（“…耐药亚群图中展示…”），拆出短标题，说明放 detail。
    parts = re.split(r"(?=图中展示|图中给出|图中显示|图中标注|表中展示|表中列出|该图|该表|本图|本表)", title, maxsplit=1)
    if len(parts) > 1:
        title = parts[0].strip()
        body = f"{parts[1].strip()} {body}".strip()
    label = f"{cn_prefix}：{title}" if cn_prefix and title else (title or cn_prefix or "图表")
    return label, body[:200]


def _point(prefix: str, units: list[ReadingUnit], kind: str) -> dict:
    """一个句子级要点；id 用首个阅读单元派生，保证多次生成/标注回填都稳定。"""
    if not units:
        raise ValueError("point 至少需要一个阅读单元")
    first = units[0]
    if prefix == "fig" or prefix == "tab":
        label, detail = _figure_label(first)
    else:
        label, detail = _label_detail(first)
    node = _node(f"{prefix}:{first.id}", label, kind, units[:2], detail=detail)
    node["unit_ids"] = [unit.id for unit in units][:6]
    return node


def _group_units(units: list[ReadingUnit], max_points: int = MAX_POINTS_PER_SECTION) -> list[list[ReadingUnit]]:
    """同一 section 内把连续单元按 1–2 个一组；段落太多时合并相邻段落压到 max_points。"""
    if not units:
        return []
    size = 2 if len(units) <= max_points * 2 else -(-len(units) // max_points)
    return [units[index:index + size] for index in range(0, len(units), size)]


def _trim_tree(tree: dict, limit: int = MAX_NODES) -> dict:
    """兜底裁剪：先丢各 section 末尾的 point，绝不丢 root/section。"""
    current = len(_flatten(tree))
    if current <= limit:
        return tree
    excess = current - limit
    for section in reversed(tree.get("children", [])):
        children = section.get("children") or []
        while excess > 0 and children:
            children.pop()
            excess -= 1
        if excess <= 0:
            break
    return tree


def _result_points(section_units: list[ReadingUnit]) -> list[dict]:
    """结果章节：正文单元按 1–2 个连续单元切点（最多 8 个），保留页码与原文。"""
    points = []
    for group in _group_units(section_units, max_points=8):
        points.append(_point("pt", group, "finding"))
    return points


def _evidence_points(by_kind: dict[str, list[ReadingUnit]]) -> list[dict]:
    """Figure/Table 各自成为一个 evidence point；它们是"证据定位"入口，不占结果正文配额。"""
    points = []
    for prefix, kind in (("fig", "FIGURE"), ("tab", "TABLE")):
        for unit in by_kind.get(kind, [])[:MAX_EVIDENCE_POINTS]:
            points.append(_point(prefix, [unit], "evidence"))
    return points


# 分析维度（不是 PDF 目录的镜像）：按“问题—背景—方法—发现—证据—局限—贡献”组织，
# 对应结构化论文分析（UCLA Structured Article Analysis / Keshav 三遍法）的阅读清单。
_ANALYSIS_BUCKETS = (
    ("question", "研究问题与动机", "question"),
    ("background", "背景与概念", "question"),
    ("method", "数据与方法", "method"),
    ("finding", "主要发现", "finding"),
    ("evidence", "证据与图表", "evidence"),
    ("limitation", "局限与边界", "limitation"),
    ("contribution", "贡献与启示", "extension"),
)
_BUCKET_KEYWORDS: dict[str, tuple[str, ...]] = {
    "question": ("研究问题", "问题是", "目的", "目标", "假设", "动机", "空白", "不足", "挑战", "旨在", "本文提出",
                 "we ask", "we address", "this paper studies", "aim", "objective", "hypothesis",
                 "research question", "gap", "challenge", "motivation"),
    "method": ("方法", "数据", "样本", "实验设计", "模型", "采集", "测量", "训练", "统计", "队列", "患者",
               "dataset", "sample", "we use", "we collect", "we train", "method", "model", "design",
               "measure", "procedure", "participants", "cohort"),
    "finding": ("结果", "发现", "表明", "显示", "提高", "降低", "相关", "显著", "优于", "结论是",
                "we find", "results show", "we show", "increased", "decreased", "associated", "outperform", "suggest"),
    "limitation": ("局限", "限制", "不足", "未能", "不能", "偏差", "偏倚", "注意", "未来", "后续", "外部效度", "泛化",
                   "limitation", "limited", "cannot", "future work", "bias", "threat", "generaliz", "caveat"),
    "contribution": ("贡献", "启示", "意义", "应用", "推广", "建议", "实践", "影响", "政策", "后续", "未来", "展望",
                     "contribution", "implication", "we contribute", "impact", "application", "practice", "future"),
}
_MAX_POINTS_PER_BUCKET = 4
_MAX_EVIDENCE_BUCKET_POINTS = 3


def _has_any(text: str, words: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in words)


def _classify_sentence(kind: str, sentence: str) -> str:
    """一句话归到哪个分析维度：先看章节，再看关键词（规则、可复现、不编造）。"""
    if kind in {"FIGURE", "TABLE"}:
        return "evidence"
    if kind == "METHODS":
        return "limitation" if _has_any(sentence, _BUCKET_KEYWORDS["limitation"]) else "method"
    if kind == "RESULTS":
        if _has_any(sentence, _BUCKET_KEYWORDS["limitation"]):
            return "limitation"
        if _has_any(sentence, _BUCKET_KEYWORDS["contribution"]):
            return "contribution"
        return "finding"
    if kind == "DISCUSSION":
        if _has_any(sentence, _BUCKET_KEYWORDS["limitation"]):
            return "limitation"
        if _has_any(sentence, _BUCKET_KEYWORDS["contribution"]):
            return "contribution"
        return "finding"
    if kind == "CONCLUSION":
        # 结论里的“后续/未来/建议”属于贡献与启示，不是局限；只有明确的“局限/不足/不能”才算局限。
        if _has_any(sentence, _BUCKET_KEYWORDS["contribution"]):
            return "contribution"
        if _has_any(sentence, _BUCKET_KEYWORDS["limitation"]):
            return "limitation"
        return "contribution"
    # 摘要/引言/正文：按关键词打分（问题 > 贡献 > 发现 > 方法 > 局限 > 背景）
    for bucket in ("question", "contribution", "finding", "method", "limitation"):
        if _has_any(sentence, _BUCKET_KEYWORDS[bucket]):
            return bucket
    # 没有关键词时按章节兜底，保证每个分析维度都有内容（否则测试用短文本会得到空树）。
    return {"RESULTS": "finding", "METHODS": "method", "DISCUSSION": "limitation",
            "CONCLUSION": "contribution", "ABSTRACT": "background", "INTRODUCTION": "background"}.get(kind, "background")


def _sentence_label_detail(sentence: str) -> tuple[str, str]:
    """句子 → 短语标签 + 原句摘要：标签取第一小句，避免节点变成一段话。"""
    cleaned = _clean_text(sentence)
    clauses = [part.strip() for part in re.split(r"[，,；;、—–]", cleaned) if part.strip()]
    label = clauses[0] if clauses else cleaned
    if len(label) < 8 and len(clauses) > 1:
        label = f"{clauses[0]}{clauses[1]}"
    label = re.sub(r"[。！？；;，,、：:]+$", "", label).strip()
    return label, cleaned


def build_skeleton(paper: Paper, units: list[ReadingUnit]) -> dict:
    """由解析结果生成“分析维度”骨架：论文 → 7 个分析维度 → 句子级要点。

    设计依据（结构化论文分析）：研究问题与动机、数据与方法、主要发现、证据与图表、
    局限与边界、贡献与启示、背景与概念。这样不是把 PDF 目录搬一遍，而是直接回答
    “这篇论文研究什么、怎么做、发现了什么、证据是什么、有什么局限、有什么用”。
    无 AI 时也能生成 15–25 个可追溯的句子级节点；AI 仅在骨架上补中文短标注。
    """
    buckets: dict[str, list[dict]] = {bucket: [] for bucket, _, _ in _ANALYSIS_BUCKETS}
    seen_labels: dict[str, set[str]] = {bucket: set() for bucket in buckets}

    for unit in sorted(units, key=lambda item: (item.position, item.id)):
        if unit.kind in {"TITLE", "RECAP"}:
            continue
        if unit.kind in {"FIGURE", "TABLE"}:
            # 图表说明常被解析器拆成“图注/表注：…”或补占位句；直接用 heading + 图注首句。
            label, detail = _figure_label(unit)
            if label and label not in seen_labels["evidence"]:
                seen_labels["evidence"].add(label)
                point = _node(f"pt:evidence:{unit.id}:0", label, "evidence", [unit], detail=detail or label)
                point["page"] = unit.page_start
                point["unit_ids"] = [unit.id]
                if len(buckets["evidence"]) < _MAX_EVIDENCE_BUCKET_POINTS:
                    buckets["evidence"].append(point)
            continue
        for sentence in _sentences(unit.source_text):
            if len(_clean_text(sentence)) < 2:
                continue
            bucket = _classify_sentence(unit.kind, sentence)
            if bucket not in buckets:
                bucket = "background"
            limit = _MAX_EVIDENCE_BUCKET_POINTS if bucket == "evidence" else _MAX_POINTS_PER_BUCKET
            if len(buckets[bucket]) >= limit:
                continue
            label, detail = _sentence_label_detail(sentence)
            if bucket != "evidence" and re.match(r"^(?:图|表)\s*[0-9]+", label):
                continue
            if not label or label in seen_labels[bucket]:
                continue
            seen_labels[bucket].add(label)
            point_id = f"pt:{bucket}:{unit.id}:{len(buckets[bucket])}"
            point = _node(point_id, label, _bucket_kind(bucket), [unit], detail=detail)
            point["page"] = unit.page_start
            point["unit_ids"] = [unit.id]
            buckets[bucket].append(point)

    def _borrow(target: str, sources: tuple[str, ...], index: int) -> None:
        """空维度兜底：优先从相邻维度借一个点；源维度只剩一个点时复制（避免把源维度掏空）。"""
        for source in sources:
            donor = buckets[source]
            if not donor:
                continue
            pick = donor[index]
            if len(donor) > 1:
                buckets[target].append(donor.pop(index))
            else:
                duplicate = dict(pick)
                duplicate["id"] = pick["id"].replace("pt:", f"pt:{target}-", 1)
                buckets[target].append(duplicate)
            return

    if not buckets["question"]:
        _borrow("question", ("background", "finding", "method"), 0)
    if not buckets["contribution"]:
        _borrow("contribution", ("limitation", "finding", "method"), -1)

    sections: list[dict] = []
    for bucket, label, kind in _ANALYSIS_BUCKETS:
        points = buckets[bucket]
        if not points:
            continue
        units_for_section = [unit for unit in units
                             if any(point["unit_ids"] and point["unit_ids"][0] == unit.id for point in points)]
        sections.append(_node(f"an:{bucket}", label, kind, units_for_section, children=points))

    title = (paper.title or "论文").strip() or "论文"
    tree = _node("root", title, "title", [], children=sections)
    tree["label"] = _clean_text(title)
    return _trim_tree(tree)


def _bucket_kind(bucket: str) -> str:
    for key, _, kind in _ANALYSIS_BUCKETS:
        if key == bucket:
            return kind
    return "evidence"


def skeleton_stats(tree: dict) -> dict:
    """给前端/测试用的规模统计：章节数、句子级要点数、节点总数。"""
    flat = _flatten(tree)
    points = sum(1 for node in flat if str(node.get("id", "")).startswith(("pt:", "fig:", "tab:")))
    return {"sections": len(tree.get("children") or []), "points": points, "total": len(flat)}


def _flatten(tree: dict) -> list[dict]:
    flat = []

    def walk(node: dict) -> None:
        flat.append(node)
        for child in node.get("children", []):
            walk(child)

    walk(tree)
    return flat


def apply_annotations(tree: dict, annotations: list[dict], valid_unit_ids: set[str]) -> dict:
    """把 AI 返回的标注合并进骨架；只接受真实存在的 node_id 与 unit_id。"""
    by_id = {node["id"]: node for node in _flatten(tree)}
    for item in annotations:
        node = by_id.get(str(item.get("node_id", "")))
        if node is None:
            continue
        label = str(item.get("label", "")).strip()
        if label:
            # AI 标注比规则首句更适合当标题，允许到 40 字（后端再兜底截断）。
            node["label"] = label[:40]
        kind = str(item.get("kind", "")).strip()
        if kind in {"question", "method", "evidence", "finding", "limitation", "extension"}:
            node["kind"] = kind
        referenced = [unit_id for unit_id in item.get("unit_ids", []) if unit_id in valid_unit_ids]
        if referenced:
            node["unit_ids"] = referenced[:6]
    return tree


def annotation_request(tree: dict) -> dict:
    """只把骨架的标题/类型/可用单元喂给模型，不把整篇原文塞进去（省 token、少幻觉）。"""
    skeleton = []
    for node in _flatten(tree):
        skeleton.append({
            "node_id": node["id"],
            "heading": node["label"],
            "kind": node["kind"],
            "unit_ids": node["unit_ids"],
            "page": node["page"],
            "detail": node.get("detail", ""),
        })
    return {"skeleton": skeleton}


def find_saved_map(db, owner: str, paper_id: str, kind: str, revision: str) -> dict | None:
    rows = db.scalars(select(ResearchArtifact).where(
        ResearchArtifact.owner_id == owner, ResearchArtifact.kind == kind,
        ResearchArtifact.paper_ids_json == json.dumps([paper_id]),
    ).order_by(ResearchArtifact.created_at.desc())).all()
    for row in rows:
        payload = json.loads(row.payload_json)
        if payload.get("parse_revision") == revision:
            return {"id": row.id, "kind": row.kind, "paper_ids": [paper_id],
                    "payload": payload, "created_at": row.created_at.isoformat()}
    return None


async def execute_mindmap(owner: str, paper_id: str, *, emit=None, timeout: float | None = None) -> dict:
    from ..research import save_artifact  # 延迟导入，避免 research <-> mindmap 循环依赖
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
        revision = parse_revision(paper, units)
        cached = find_saved_map(db, owner, paper_id, "paper_mindmap", revision)
        if cached is not None:
            return cached
        expected_revision = (paper.content_revision, paper.sha256)
        skeleton = build_skeleton(paper, units)

    annotations: list[dict] = []
    if emit is not None:
        await emit("stage", {"stage": "thinking", "label": "提取关键点与证据位置"})
    try:
        from . import research_ai
        request = annotation_request(skeleton)
        request["paper_title"] = paper.title
        runner = getattr(research_ai, "run_task_events", None)

        async def invoke() -> dict:
            if runner is not None:
                return await runner("mindmap_annotate", request)
            return await research_ai.run_task("mindmap_annotate", request)

        result = await asyncio.wait_for(invoke(), timeout=timeout) if timeout else await invoke()
        annotations = list(result.get("annotations", []))
    except Exception as exc:  # noqa: BLE001 - 导图不依赖 AI 成功：失败就走确定性骨架
        logger.warning("Mindmap annotation failed, falling back to skeleton: %s", type(exc).__name__)

    if emit is not None:
        await emit("stage", {"stage": "validating", "label": "校验节点证据"})
    tree = apply_annotations(skeleton, annotations, {unit.id for unit in units})
    payload = {
        "paper_id": paper_id,
        "parse_revision": revision,
        "root": tree,
        "legend": {"title": "论文", "question": "问题/背景", "method": "方法/数据", "evidence": "证据/图表",
                   "finding": "发现", "limitation": "局限/边界", "extension": "贡献/启示"},
        "annotation_count": len(annotations),
        "stats": skeleton_stats(tree),
    }
    return save_artifact(owner, "paper_mindmap", [paper_id], payload,
                         expected_revisions={paper_id: expected_revision})
