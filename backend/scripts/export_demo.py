"""Export only the explicitly selected example papers and results, without users or secrets."""
import argparse
import json
import shutil
import sqlite3
from pathlib import Path, PureWindowsPath

PAPERS = ["798012b1-80d5-40e8-93c9-8e8c52ed3547", "1bca0645-5796-47b2-9e98-85b9b81315df", "15362dca-feeb-4c7b-b8ab-29cfa149d49e"]
ARTIFACTS = ["6307011e-ee7a-4a59-a045-3401bdb562f0", "4f47b829-f53b-4fc9-aafb-b30a3325343c", "48d78f0f-138e-412d-a32d-8009275dbfb9"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("uploads", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    db = sqlite3.connect(f"file:{args.database.resolve().as_posix()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    result = {name: [] for name in ("papers", "reading_units", "paper_images", "messages", "research_artifacts")}
    for paper_id in PAPERS:
        paper = db.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
        if not paper:
            raise ValueError(f"Missing example paper {paper_id}")
        paper = dict(paper)
        source = args.uploads / paper["owner_id"] / paper_id
        target = args.output / "files" / paper_id
        if not (source / paper["stored_filename"]).is_file():
            raise ValueError(f"Missing PDF for {paper_id}")
        shutil.copytree(source, target)
        paper["local_file_path"] = paper["stored_filename"]
        result["papers"].append(paper)
        for table in ("reading_units", "paper_images", "messages"):
            for row in db.execute(f"SELECT * FROM {table} WHERE paper_id = ?", (paper_id,)):
                row = dict(row)
                if table == "paper_images":
                    parts = PureWindowsPath(row["local_file_path"]).parts
                    row["local_file_path"] = "/".join(parts[parts.index(paper_id) + 1:])
                    if not (target / row["local_file_path"]).is_file():
                        raise ValueError(f"Missing image for {paper_id}")
                result[table].append(row)
    for artifact_id in ARTIFACTS:
        row = db.execute("SELECT * FROM research_artifacts WHERE id = ?", (artifact_id,)).fetchone()
        if not row:
            raise ValueError(f"Missing example result {artifact_id}")
        result["research_artifacts"].append(dict(row))
    (args.output / "seed.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"Exported {len(PAPERS)} papers and {len(ARTIFACTS)} selected results")


if __name__ == "__main__":
    main()
