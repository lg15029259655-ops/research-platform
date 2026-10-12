"""Run once manually after configuring .env. Never prints credentials or AI content."""

import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import COOKIE_NAME, session_hash
from app.db import SessionLocal
from app.main import app
from app.models import DesignVersion, ResearchArtifact, ResearchWorkspace, User


ROOT = Path(__file__).resolve().parents[1]
PDFS = [ROOT / "data/demo-test/W2901390845.pdf",
        ROOT / "data/demo-test/rotator-inflammation.pdf"]


def check(response, label):
    if response.status_code != 200:
        print(label, "FAILED", response.status_code, str(response.json())[:220], flush=True)
        raise RuntimeError(label)
    print(label, "OK", flush=True)
    return response.json()


def run():
    with TestClient(app) as client:
        owner = None
        try:
            workspace = check(client.get("/api/workspace"), "workspace")
            with SessionLocal() as db:
                owner = db.scalar(select(User.id).where(User.session_hash ==
                                  session_hash(client.cookies.get(COOKIE_NAME))))
            ids = []
            for path in PDFS:
                with path.open("rb") as file:
                    paper = check(client.post("/api/papers", files={"file":
                        (path.name, file, "application/pdf")}), f"upload {path.name}")
                assert paper["status"] == "parsed"
                ids.append(paper["id"])
            check(client.patch("/api/workspace", json={"query": "rotator cuff tear mitochondrial dysfunction",
                "domain": "biomed", "core_paper_id": ids[0], "selected_paper_ids": ids}), "workspace context")
            manifest = check(client.get(f"/api/papers/{ids[0]}/manifest"), "manifest")
            print("manifest units", len(manifest.get("units", [])), flush=True)
            with client.stream("POST", f"/api/papers/{ids[0]}/chat", json={"action": "START"}) as response:
                text = "".join(response.iter_text())
            assert '"type": "done"' in text and '"type": "delta"' in text
            print("streaming reading OK", flush=True)
            xray = check(client.post(f"/api/research/xray/{ids[0]}"), "xray")
            assert xray["payload"]["stages"]
            synthesis = check(client.post("/api/research/compare", json={"paper_ids": ids}), "comparison")
            assert synthesis["payload"]["dimensions"]
            novelty = check(client.post("/api/research/novelty", json={"query":
                "rotator cuff tear mitochondrial dysfunction"}), "novelty")
            print("novelty search cached", novelty["payload"].get("search_cached"), flush=True)
            goal = "Investigate whether mitochondrial dysfunction drives rotator cuff injury outcomes"
            design = check(client.post("/api/research/design", json={"goal": goal}), "design V1")
            revised = check(client.post("/api/research/design", json={"goal": goal,
                "action": "causality", "current_design": design["payload"]}), "design V2")
            node_id = revised["payload"]["nodes"][0]["id"]
            local = check(client.post("/api/research/design", json={"goal": goal,
                "action": "node", "node_id": node_id,
                "instruction": "Improve the evidence strategy for this node",
                "current_design": revised["payload"]}), "design V3 local")
            assert local["version"]["number"] >= 3
            versions = check(client.get("/api/research/design/versions"), "version history")
            check(client.post(f"/api/research/design/versions/{versions[-1]['version_id']}/restore"), "restore V1")
            print("DEMO COMPLETE", flush=True)
        finally:
            for paper in client.get("/api/papers").json():
                client.delete(f"/api/papers/{paper['id']}")
            if owner:
                with SessionLocal() as db:
                    db.query(DesignVersion).filter(DesignVersion.owner_id == owner).delete()
                    db.query(ResearchArtifact).filter(ResearchArtifact.owner_id == owner).delete()
                    db.query(ResearchWorkspace).filter(ResearchWorkspace.owner_id == owner).delete()
                    user = db.get(User, owner)
                    if user:
                        db.delete(user)
                    db.commit()


if __name__ == "__main__":
    run()
