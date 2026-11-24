"""Enrich an existing public demo seed in an isolated database."""
import argparse
import asyncio
import json
import os
import shutil
import tempfile
from pathlib import Path
from uuid import uuid4


async def prepare(seed, root):
    from sqlalchemy import delete, select

    from app.db import Base, SessionLocal, engine
    from app.models import Paper, ReadingUnit, ResearchArtifact, User
    from app.research import execute_novelty, execute_xray
    from app.services.bailian_service import connection_pool as model_pool
    from app.services.demo_service import _replace, _seed_workspace
    from app.services.mindmap_service import execute_mindmap
    from app.services.openalex_service import connection_pool as discovery_pool
    from app.services.paper_experiment_service import execute_paper_experiments

    Base.metadata.create_all(engine)
    owner = str(uuid4())
    with SessionLocal() as db:
        db.add(User(id=owner, session_hash=uuid4().hex))
        db.flush()
        _seed_workspace(db, owner, None, root, seed)
        # The disposable import creates fallback maps for missing entries.
        # Remove only these placeholders so preparation can annotate them.
        old_maps = [row for row in seed["research_artifacts"] if row["kind"] == "paper_mindmap"]
        papers_with_maps = {json.loads(row["paper_ids_json"])[0] for row in old_maps}
        papers = {p.title: p for p in db.scalars(select(Paper).where(Paper.owner_id == owner))}
        paper_ids = {}
        mapping = {}
        missing_maps = []
        for old in seed["papers"]:
            paper = papers[old["title"]]
            paper_ids[paper.id] = old["id"]
            mapping[paper.id] = old["id"]
            units = {u.position: u.id for u in db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id == paper.id))}
            mapping.update({units[u["position"]]: u["id"] for u in seed["reading_units"] if u["paper_id"] == old["id"]})
            if old["id"] not in papers_with_maps:
                missing_maps.append(paper.id)
                db.execute(delete(ResearchArtifact).where(
                    ResearchArtifact.owner_id == owner, ResearchArtifact.kind == "paper_mindmap",
                    ResearchArtifact.paper_ids_json == json.dumps([paper.id]),
                ))
        db.commit()

    goal = next(json.loads(row["payload_json"])["goal"] for row in seed["research_artifacts"]
                if row["kind"] == "experiment_design")
    semaphore = asyncio.Semaphore(3)

    async def run(label, operation, value, **options):
        async with semaphore:
            print(f"Preparing {label}", flush=True)
            result = await operation(owner, value, **options)
            print(f"Saved {label}", flush=True)
            return result

    async with model_pool(), discovery_pool():
        tasks = []
        if not any(row["kind"] == "novelty_analysis" and json.loads(row["payload_json"]).get("query") == goal
                   for row in seed["research_artifacts"]):
            tasks.append(run("novelty scan", execute_novelty, goal, timeout=110, fallback=False))
        for paper_id, old_id in paper_ids.items():
            for kind, operation in (("paper_summary", execute_xray), ("paper_experiments", execute_paper_experiments)):
                if not any(row["kind"] == kind and json.loads(row["paper_ids_json"]) == [old_id]
                           for row in seed["research_artifacts"]):
                    tasks.append(run(f"{kind} {old_id[:8]}", operation, paper_id, timeout=110))
        tasks.extend(run(f"paper_mindmap {mapping[paper_id][:8]}", execute_mindmap, paper_id, timeout=110)
                     for paper_id in missing_maps)
        results = await asyncio.gather(*tasks)

    for result in results:
        ids = _replace(result["paper_ids"], mapping)
        payload = _replace(result["payload"], mapping)
        seed["research_artifacts"] = [row for row in seed["research_artifacts"]
                                      if (row["kind"], json.loads(row["paper_ids_json"])) != (result["kind"], ids)]
        seed["research_artifacts"].append({"id": result["id"], "kind": result["kind"], "owner_id": None,
                                          "paper_ids_json": json.dumps(ids), "payload_json": json.dumps(payload, ensure_ascii=False),
                                          "created_at": result["created_at"]})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("The output directory must be new")
    seed = json.loads((args.source / "seed.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="medread-prepare-demo-") as directory:
        root = Path(directory)
        os.environ["DATABASE_URL"] = "sqlite:///" + (root / "demo.db").as_posix()
        os.environ["UPLOAD_DIR"] = str(root / "uploads")
        from app.db import engine

        try:
            asyncio.run(prepare(seed, args.source))
        finally:
            engine.dispose()
    shutil.copytree(args.source / "files", args.output / "files")
    (args.output / "seed.json").write_text(json.dumps(seed, ensure_ascii=False), encoding="utf-8")
    print(f"Prepared {len(seed['papers'])} papers and {len(seed['research_artifacts'])} saved results")


if __name__ == "__main__":
    main()
