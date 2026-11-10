"""Exercise a real process termination using a separate disposable database."""

import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import pymupdf


def test_parse_recovers_after_process_termination(tmp_path):
    database = tmp_path / "crash-test.db"
    pdf = tmp_path / "input.pdf"
    document = pymupdf.open()
    page = document.new_page()
    for i, line in enumerate(("Crash Recovery Study", "Abstract", "A study of recovery.",
                              "Methods", "A comparison was performed.", "Results", "The result was observed.")):
        page.insert_text((40, 50 + i * 30), line)
    pdf.write_bytes(document.tobytes())
    document.close()
    marker = tmp_path / "parsing-started"
    cookie_file = tmp_path / "cookie"
    output_file = tmp_path / "recovered.json"
    env = os.environ.copy()
    env.update(DATABASE_URL="sqlite:///" + database.as_posix(),
               UPLOAD_DIR=str(tmp_path / "uploads"), PRECOMPUTE_ON_PARSE="0",
               CRASH_PDF=str(pdf), CRASH_MARKER=str(marker), CRASH_COOKIE=str(cookie_file),
               CRASH_OUTPUT=str(output_file))
    backend_root = Path(__file__).resolve().parents[1]
    start = r'''
import os, time
from pathlib import Path
from fastapi.testclient import TestClient
from app import papers
from app.auth import COOKIE_NAME
from app.main import app
def blocked_parse(path, *, on_stage):
    on_stage("reading")
    Path(os.environ["CRASH_MARKER"]).write_text("started")
    time.sleep(120)
papers.parse_pdf = blocked_parse
with TestClient(app) as client:
    client.get("/api/session")
    Path(os.environ["CRASH_COOKIE"]).write_text(client.cookies[COOKIE_NAME])
    content = Path(os.environ["CRASH_PDF"]).read_bytes()
    client.post("/api/papers?deferred=true", files={"file": ("paper.pdf", content, "application/pdf")})
'''
    child = subprocess.Popen([sys.executable, "-c", start], cwd=backend_root, env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 20
        while not marker.exists() and child.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)
        assert marker.exists(), f"parser did not start (exit={child.poll()})"
    finally:
        child.terminate()
        child.wait(timeout=10)
    with sqlite3.connect(database) as db:
        row = db.execute("SELECT id, status, parse_token FROM papers").fetchone()
        assert row and row[1] == "reading" and row[2]
        # Advance the lease without making the test wait 30 minutes.
        db.execute("UPDATE papers SET parse_heartbeat = '2000-01-01 00:00:00' WHERE id = ?", (row[0],))
    env["CRASH_PAPER_ID"] = row[0]
    recover = r'''
import json, os
from pathlib import Path
from fastapi.testclient import TestClient
from app.auth import COOKIE_NAME
from app.main import app
with TestClient(app) as client:
    client.cookies.set(COOKIE_NAME, Path(os.environ["CRASH_COOKIE"]).read_text())
    paper_id = os.environ["CRASH_PAPER_ID"]
    status = client.get(f"/api/papers/{paper_id}/status")
    detail = client.get(f"/api/papers/{paper_id}")
    Path(os.environ["CRASH_OUTPUT"]).write_text(json.dumps({"status_code": status.status_code,
        "status": status.json(), "detail_code": detail.status_code, "detail": detail.json()}), encoding="utf-8")
'''
    subprocess.run([sys.executable, "-c", recover], cwd=backend_root, env=env,
                   check=True, timeout=30, capture_output=True)
    result = json.loads(output_file.read_text(encoding="utf-8"))
    assert result["status_code"] == 200 and result["status"]["status"] == "uploaded"
    assert result["detail_code"] == 200 and result["detail"]["status"] == "parsed"
    assert result["detail"]["units"]


def test_existing_database_receives_parse_columns_on_startup(tmp_path):
    database = tmp_path / "legacy.db"
    env = os.environ.copy()
    env.update(DATABASE_URL="sqlite:///" + database.as_posix(),
               UPLOAD_DIR=str(tmp_path / "uploads"), PRECOMPUTE_ON_PARSE="0")
    script = r'''
import sqlite3
from fastapi.testclient import TestClient
from app.db import Base, engine
from app import models
from app.main import app
Base.metadata.create_all(bind=engine)
with engine.begin() as connection:
    connection.exec_driver_sql("ALTER TABLE papers DROP COLUMN parse_token")
    connection.exec_driver_sql("ALTER TABLE papers DROP COLUMN parse_heartbeat")
    connection.exec_driver_sql("ALTER TABLE papers DROP COLUMN source_sha256")
with TestClient(app) as client:
    assert client.get("/api/health").status_code == 200
    with engine.connect() as connection:
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(papers)")}
    assert {"parse_token", "parse_heartbeat", "source_sha256"} <= columns
'''
    subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1],
                   env=env, check=True, timeout=30, capture_output=True)
