from contextlib import closing
from pathlib import Path
import sqlite3

import pytest

from scripts.backup_data import copy_data


def stored_paths(database):
    with closing(sqlite3.connect(database)) as db:
        return [db.execute(f"SELECT local_file_path FROM {table}").fetchone()[0]
                for table in ("papers", "paper_images")]


def test_backup_can_be_moved_before_restore_and_keeps_source_paths(tmp_path):
    uploads = tmp_path / "uploads"
    folder = uploads / "owner" / "paper"
    folder.mkdir(parents=True)
    originals = [folder / "paper.pdf", folder / "figure.png"]
    originals[0].write_bytes(b"%PDF-test")
    originals[1].write_bytes(b"test image")
    database = tmp_path / "live.db"
    with closing(sqlite3.connect(database)) as db, db:
        for table, file in zip(("papers", "paper_images"), originals):
            db.execute(f"CREATE TABLE {table} (id TEXT PRIMARY KEY, local_file_path TEXT)")
            db.execute(f"INSERT INTO {table} VALUES (?, ?)", (table, str(file)))

    bundle = tmp_path / "bundle"
    assert copy_data(database, uploads, bundle, restore=False) == 2
    assert stored_paths(database) == [str(path) for path in originals]
    assert stored_paths(bundle / "app.db") == ["owner/paper/paper.pdf", "owner/paper/figure.png"]
    relocated = bundle.rename(tmp_path / "relocated")

    restored = tmp_path / "restored"
    assert copy_data(relocated / "app.db", relocated / "uploads", restored, restore=True) == 2
    for recorded, original in zip(stored_paths(restored / "app.db"), originals):
        file = Path(recorded)
        assert file.is_relative_to(restored / "uploads")
        assert file.read_bytes() == original.read_bytes()

    missing_dir = tmp_path / "incomplete"
    (relocated / "uploads" / "owner" / "paper" / "figure.png").unlink()
    with pytest.raises(ValueError, match="paper_images"):
        copy_data(relocated / "app.db", relocated / "uploads", missing_dir, restore=True)
    assert not missing_dir.exists()
