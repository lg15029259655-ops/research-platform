"""One small persistent research workspace per anonymous owner."""

import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert

from .auth import current_owner
from .db import SessionLocal
from .models import Paper, ResearchArtifact, ResearchWorkspace

router = APIRouter(prefix="/api/workspace")
Owner = Depends(current_owner)
ARTIFACT_KINDS = {"synthesis_id": "paper_compare", "novelty_id": "novelty_analysis",
                  "design_version_id": "experiment_design"}


def workspace_data(item: ResearchWorkspace) -> dict:
    return {"workspace_id": item.id, "query": item.query, "domain": item.domain,
            "study_type": item.study_type,
            "selected_paper_ids": json.loads(item.selected_paper_ids_json),
            "core_paper_id": item.core_paper_id, "synthesis_id": item.synthesis_id,
            "research_gap": item.research_gap, "gap_context": json.loads(item.gap_context_json),
            "design_idea": item.design_idea, "novelty_id": item.novelty_id,
            "design_version_id": item.design_version_id,
            "created_at": item.created_at.isoformat(), "updated_at": item.updated_at.isoformat()}


def get_or_create(db, owner: str) -> ResearchWorkspace:
    by_owner = select(ResearchWorkspace).where(ResearchWorkspace.owner_id == owner)
    item = db.scalar(by_owner)
    if item is None:
        db.execute(insert(ResearchWorkspace).values(id=str(uuid4()), owner_id=owner)
                   .on_conflict_do_nothing(index_elements=[ResearchWorkspace.owner_id]))
        db.commit()
        item = db.scalars(by_owner).one()
    return item


def prune_stale_idea_results(db, item: ResearchWorkspace) -> None:
    for field, query_field in (("novelty_id", "query"), ("design_version_id", "goal")):
        artifact_id = getattr(item, field)
        if not artifact_id:
            continue
        artifact = db.get(ResearchArtifact, artifact_id)
        payload = json.loads(artifact.payload_json) if artifact and artifact.owner_id == item.owner_id else {}
        if payload.get(query_field, "").strip() != item.design_idea.strip():
            setattr(item, field, None)
    db.commit()


class WorkspacePatch(BaseModel):
    query: str | None = Field(default=None, max_length=800)
    domain: str | None = Field(default=None, max_length=50)
    study_type: str | None = Field(default=None, max_length=80)
    selected_paper_ids: list[str] | None = Field(default=None, max_length=5)
    core_paper_id: str | None = None
    synthesis_id: str | None = None
    research_gap: str | None = Field(default=None, max_length=3000)
    gap_context: dict | None = None
    design_idea: str | None = Field(default=None, max_length=1500)
    novelty_id: str | None = None
    design_version_id: str | None = None


@router.get("")
def get_workspace(owner: str = Owner):
    with SessionLocal() as db:
        item = get_or_create(db, owner)
        prune_stale_idea_results(db, item)
        return workspace_data(item)


@router.patch("")
def patch_workspace(patch: WorkspacePatch, owner: str = Owner):
    changes = patch.model_dump(exclude_unset=True)
    with SessionLocal() as db:
        item = get_or_create(db, owner)
        if "design_idea" in changes and changes["design_idea"] != item.design_idea:
            for field in ("novelty_id", "design_version_id"):
                if field not in changes:
                    setattr(item, field, None)
        paper_ids = changes.get("selected_paper_ids")
        core_id = changes.get("core_paper_id")
        referenced = set(paper_ids or []) | ({core_id} if core_id else set())
        if paper_ids is not None and len(paper_ids) != len(set(paper_ids)):
            raise HTTPException(422, "论文对比篮不能重复添加论文")
        if referenced:
            owned = set(db.scalars(select(Paper.id).where(Paper.owner_id == owner, Paper.id.in_(referenced))).all())
            if owned != referenced:
                raise HTTPException(404, "论文不存在")
        for field, kind in ARTIFACT_KINDS.items():
            artifact_id = changes.get(field)
            if artifact_id and not db.scalar(select(ResearchArtifact.id).where(
                ResearchArtifact.id == artifact_id, ResearchArtifact.owner_id == owner,
                ResearchArtifact.kind == kind)):
                raise HTTPException(404, "研究结果不存在")
        for field, value in changes.items():
            if field == "selected_paper_ids":
                item.selected_paper_ids_json = json.dumps(value or [])
            elif field == "gap_context":
                encoded = json.dumps(value or {}, ensure_ascii=False)
                if len(encoded) > 12000:
                    raise HTTPException(422, "研究空白上下文过长，请精简后重试")
                item.gap_context_json = encoded
            else:
                setattr(item, field, value)
        db.commit()
        db.refresh(item)
        return workspace_data(item)
