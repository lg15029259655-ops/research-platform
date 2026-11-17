import json

from fastapi.testclient import TestClient

from app.main import app


def test_demo_keeps_active_workspace_and_initializes_new_visitors(monkeypatch, tmp_path):
    seed_dir = tmp_path / "seed"
    folder = seed_dir / "files" / "seed-paper"
    folder.mkdir(parents=True)
    (folder / "paper.pdf").write_bytes(b"%PDF-demo")
    (seed_dir / "seed.json").write_text(json.dumps({
        "papers": [{"id": "seed-paper", "title": "Example", "original_filename": "paper.pdf",
                    "stored_filename": "paper.pdf", "mime_type": "application/pdf",
                    "file_size_bytes": 9, "sha256": "0" * 64, "status": "parsed", "domain": "biomed"}],
        "reading_units": [], "paper_images": [], "messages": [],
        "research_artifacts": [
            {"id": "seed-compare", "kind": "paper_compare", "paper_ids_json": '["seed-paper"]',
             "payload_json": "{}"},
            {"id": "seed-design", "kind": "experiment_design", "paper_ids_json": '["seed-paper"]',
             "payload_json": '{"goal": "Example design"}'},
        ],
    }), encoding="utf-8")
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))

    with TestClient(app) as client:
        changes = {"query": "My current project", "domain": "education", "study_type": "cohort",
                   "design_idea": "My current design"}
        assert client.patch("/api/workspace", json=changes).status_code == 200
        monkeypatch.setenv("DEMO_SEED_DIR", str(seed_dir))
        active = client.get("/api/workspace").json()
        assert all(active[key] == value for key, value in changes.items())
        assert active["synthesis_id"] is None
        assert active["design_version_id"] is None
        active_papers = client.get("/api/papers").json()
        assert len(active_papers) == 1

        client.cookies.clear()
        example = client.get("/api/workspace").json()
        assert example["synthesis_id"]
        assert example["design_version_id"]
        assert example["design_idea"] == "Example design"
        paper_id, = example["selected_paper_ids"]
        assert paper_id != active_papers[0]["id"]
        assert [paper["id"] for paper in client.get("/api/papers").json()] == [paper_id]
