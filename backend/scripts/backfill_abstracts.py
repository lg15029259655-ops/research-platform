"""Add conservatively recovered unlabeled abstracts without replacing paper history."""

from pathlib import Path
from uuid import uuid4

import pymupdf
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Paper, ReadingUnit
from app.services.pdf_service import extract_unlabeled_abstract


def main() -> None:
    repaired = 0
    with SessionLocal() as db:
        for paper in db.scalars(select(Paper).where(Paper.status == "parsed")).all():
            units = db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id == paper.id).order_by(ReadingUnit.position)).all()
            if not units or any(unit.kind == "ABSTRACT" for unit in units):
                continue
            if not paper.local_file_path or not Path(paper.local_file_path).is_file():
                continue
            with pymupdf.open(paper.local_file_path) as document:
                abstract = extract_unlabeled_abstract(document[0])
            if not abstract:
                continue
            for unit in units:
                if unit.position >= 1:
                    unit.position += 1
            db.add(ReadingUnit(id=f"{paper.id}:abstract:{uuid4().hex[:8]}", paper_id=paper.id,
                               position=1, kind="ABSTRACT", heading="摘要（首页正文块）",
                               page_start=1, page_end=1, source_text=abstract))
            if not paper.abstract:
                paper.abstract = abstract
            repaired += 1
        db.commit()
    print(f"Recovered unlabeled abstracts: {repaired}")


if __name__ == "__main__":
    main()
