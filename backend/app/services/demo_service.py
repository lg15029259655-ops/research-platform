"""Create isolated editable examples for a new anonymous visitor, when configured."""
import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from ..config import upload_dir
from ..models import DesignVersion, Message, Paper, PaperImage, ReadingUnit, ResearchArtifact, ResearchWorkspace
from .mindmap_service import build_skeleton, parse_revision, skeleton_stats


def _replace(value, mapping):
    if isinstance(value, str):
        for old, new in mapping.items():
            value = value.replace(old, new)
        return value
    if isinstance(value, list):
        return [_replace(item, mapping) for item in value]
    if isinstance(value, dict):
        return {key: _replace(item, mapping) for key, item in value.items()}
    return value


def _row(model, data):
    result = dict(data)
    for column in model.__table__.columns:
        if column.name in result and result[column.name] is not None and column.type.__class__.__name__ == "DateTime":
            result[column.name] = datetime.fromisoformat(result[column.name])
    return result


def _copy_example_file(source, target):
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def seed_new_workspace(db, owner, workspace=None):
    directory = os.getenv("DEMO_SEED_DIR", "").strip()
    if not directory:
        return
    root = Path(directory)
    seed = json.loads((root / "seed.json").read_text(encoding="utf-8"))
    names = ("papers", "reading_units", "paper_images", "messages", "research_artifacts")
    mapping = {row["id"]: str(uuid4()) for name in names for row in seed[name]}
    destination = upload_dir() / owner
    try:
        papers = []
        units_by_paper = {}
        for original in seed["papers"]:
            row = _row(Paper, _replace(original, mapping))
            row["owner_id"] = owner
            folder = destination / row["id"]
            shutil.copytree(root / "files" / original["id"], folder, copy_function=_copy_example_file)
            row["local_file_path"] = str(folder / row["stored_filename"])
            row["parse_token"] = None
            row["parse_heartbeat"] = None
            paper = Paper(**row)
            db.add(paper)
            papers.append(paper)
            units_by_paper[paper.id] = []
        db.flush()
        for original in seed["reading_units"]:
            unit = ReadingUnit(**_row(ReadingUnit, _replace(original, mapping)))
            db.add(unit)
            units_by_paper[unit.paper_id].append(unit)
        db.flush()
        for original in seed["paper_images"]:
            row = _row(PaperImage, _replace(original, mapping))
            row["local_file_path"] = str(destination / row["paper_id"] / original["local_file_path"])
            db.add(PaperImage(**row))
        for original in seed["messages"]:
            db.add(Message(**_row(Message, _replace(original, mapping))))
        by_kind = {}
        for original in seed["research_artifacts"]:
            row = _row(ResearchArtifact, _replace(original, mapping))
            row["owner_id"] = owner
            if row["kind"] == "paper_mindmap":
                paper_id = json.loads(row["paper_ids_json"])[0]
                paper = next(item for item in papers if item.id == paper_id)
                payload = json.loads(row["payload_json"])
                payload["parse_revision"] = parse_revision(paper, units_by_paper[paper_id])
                row["payload_json"] = json.dumps(payload, ensure_ascii=False)
            artifact = ResearchArtifact(**row)
            db.add(artifact)
            by_kind.setdefault(row["kind"], []).append(artifact)
        for paper in papers:
            if any(json.loads(a.paper_ids_json) == [paper.id] for a in by_kind.get("paper_mindmap", [])):
                continue
            units = sorted(units_by_paper[paper.id], key=lambda unit: unit.position)
            tree = build_skeleton(paper, units)
            payload = {"paper_id": paper.id, "parse_revision": parse_revision(paper, units), "root": tree,
                       "legend": {"title": "论文", "question": "问题/背景", "method": "方法/数据", "evidence": "证据/图表", "finding": "发现", "limitation": "局限/边界", "extension": "贡献/启示"},
                       "annotation_count": 0, "stats": skeleton_stats(tree)}
            db.add(ResearchArtifact(id=str(uuid4()), owner_id=owner, kind="paper_mindmap",
                                    paper_ids_json=json.dumps([paper.id]), payload_json=json.dumps(payload, ensure_ascii=False)))
        comparison = by_kind["paper_compare"][0]
        design = by_kind["experiment_design"][0]
        goal = json.loads(design.payload_json)["goal"]
        if workspace is None:
            workspace = ResearchWorkspace(id=str(uuid4()), owner_id=owner)
            db.add(workspace)
        workspace.domain = "biomed"
        workspace.study_type = "unspecified"
        workspace.selected_paper_ids_json = json.dumps([p.id for p in papers])
        workspace.core_paper_id = papers[0].id
        workspace.synthesis_id = comparison.id
        workspace.design_idea = goal
        workspace.design_version_id = design.id
        db.flush()
        db.add(DesignVersion(id=str(uuid4()), owner_id=owner, workspace_id=workspace.id, artifact_id=design.id,
                             version_number=1, action="example", changed_nodes_json="{}"))
        db.flush()
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise
