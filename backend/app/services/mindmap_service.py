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
    "RESULTS": "结果", "DISCUSSION": "讨论", "CONCLUSION": "结论",
    "BODY": "正文", "UNCLASSIFIED": "未分类正文",
}
MAX_NODES = 60


def _slug(text: str, fallback: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", text).strip("-")[:40]
    return cleaned or fallback


def parse_revision(paper: Paper, units: list[ReadingUnit]) -> str:
    """导图缓存版本：PDF 内容 + 单元结构变了才重算（改阅读进度不会触发）。"""
    seed = f"{paper.sha256}|{len(units)}|{units[0].id if units else ''}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]


def _node(node_id: str, label: str, kind: str, units: list[ReadingUnit], *,
          inferred: bool = False, children: list[dict] | None = None) -> dict:
    first = units[0] if units else None
    return {
        "id": node_id,
        "label": label[:24],
        "kind": kind,
        "unit_ids": [unit.id for unit in units][:6],
        "page": first.page_start if first else None,
        "inferred": inferred,
        "children": children or [],
    }


def build_skeleton(paper: Paper, units: list[ReadingUnit]) -> dict:
    """由解析结果生成章节骨架。返回值是干净树，不含 AI 内容。"""
    by_kind: dict[str, list[ReadingUnit]] = {}
    for unit in units:
        by_kind.setdefault(unit.kind, []).append(unit)

    root_units = [unit for unit in by_kind.get("TITLE", [])] or []
    children: list[dict] = []

    for kind in _SECTION_ORDER:
        section_units = by_kind.get(kind, [])
        if not section_units:
            continue
        if kind == "RESULTS":
            # Results 可能被解析成多个子小节：每个子小节一个节点，图/表挂在结果下。
            grouped: dict[str, list[ReadingUnit]] = {}
            for unit in section_units:
                grouped.setdefault(unit.heading or "结果", []).append(unit)
            result_children = [
                _node(f"res:{_slug(heading, str(index))}", heading[:24], "evidence", items[:1])
                for index, (heading, items) in enumerate(grouped.items())
            ]
            for index, unit in enumerate(by_kind.get("FIGURE", [])):
                result_children.append(_node(f"fig:{unit.id}", unit.heading or f"Figure {index + 1}",
                                             "evidence", [unit]))
            for index, unit in enumerate(by_kind.get("TABLE", [])):
                result_children.append(_node(f"tab:{unit.id}", unit.heading or f"Table {index + 1}",
                                             "evidence", [unit]))
            children.append(_node("sec:results", "结果", "finding", section_units, children=result_children))
            continue
        children.append(_node(f"sec:{kind.lower()}", _SECTION_LABEL.get(kind, kind.title()),
                              {"ABSTRACT": "question", "INTRODUCTION": "question", "METHODS": "method",
                               "DISCUSSION": "limitation", "CONCLUSION": "finding"}.get(kind, "evidence"),
                              section_units))

    # 没有标准章节的 PDF（长综述/扫描件）也要有树：按未分类正文分页给出节点。
    unclassified = by_kind.get("UNCLASSIFIED", []) + by_kind.get("BODY", [])
    for index, unit in enumerate(unclassified[:8]):
        children.append(_node(f"body:{unit.id}", f"正文 · PDF {unit.page_start or '?'} 页",
                              "evidence", [unit]))

    title = (paper.title or "论文").strip() or "论文"
    tree = _node("root", title, "title", root_units, children=children[:MAX_NODES])
    return tree


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
            node["label"] = label[:24]
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
        })
    return {"skeleton": skeleton}


def _existing_artifact(owner: str, paper_id: str, revision: str) -> dict | None:
    with SessionLocal() as db:
        rows = db.scalars(select(ResearchArtifact).where(
            ResearchArtifact.owner_id == owner,
            ResearchArtifact.kind == "paper_mindmap",
        ).order_by(ResearchArtifact.created_at.desc())).all()
        for row in rows:
            if json.loads(row.paper_ids_json) != [paper_id]:
                continue
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
        skeleton = build_skeleton(paper, units)

    cached = _existing_artifact(owner, paper_id, revision)
    if cached is not None:
        return cached

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
        "legend": {"title": "论文", "question": "问题/背景", "method": "方法", "evidence": "证据",
                   "finding": "发现", "limitation": "局限/讨论", "extension": "延伸"},
        "annotation_count": len(annotations),
    }
    return save_artifact(owner, "paper_mindmap", [paper_id], payload)
