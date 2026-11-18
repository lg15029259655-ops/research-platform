"""Copy quiescent MedRead data to a backup bundle or a new restore directory."""

import argparse
from contextlib import closing
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import tempfile


def reject_links(directory, names):
    for name in names:
        path = Path(directory) / name
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
            raise ValueError("上传目录含符号链接或目录联接，请先核对存储路径。")
    return []


def rewrite_paths(db, uploads: Path, target: Path, restore: bool) -> int:
    updated = 0
    for table in ("papers", "paper_images"):
        rows = db.execute(f"SELECT id, local_file_path FROM {table} WHERE local_file_path <> ''").fetchall()
        for row_id, recorded in rows:
            try:
                if restore:
                    relative = PurePosixPath(recorded)
                    if relative.is_absolute() or ".." in relative.parts:
                        raise ValueError(recorded)
                    relative = Path(*relative.parts)
                else:
                    relative = Path(recorded).resolve().relative_to(uploads)
                file = (uploads / relative).resolve()
                if not file.is_relative_to(uploads) or not file.is_file():
                    raise ValueError(recorded)
            except (OSError, ValueError) as exc:
                raise ValueError(f"{table} 有文件缺失或位于上传目录之外，记录 ID {row_id}。") from exc
            path = str(target / relative) if restore else relative.as_posix()
            db.execute(f"UPDATE {table} SET local_file_path = ? WHERE id = ?", (path, row_id))
            updated += 1
    return updated


def copy_data(database: Path, uploads: Path, destination: Path, *, restore: bool) -> int:
    database, uploads, destination = (path.resolve() for path in (database, uploads, destination))
    if destination.exists() or destination.is_relative_to(uploads):
        raise ValueError("目标必须是上传目录之外的新目录。")
    if not database.is_file() or not uploads.is_dir():
        raise ValueError("找不到 SQLite 数据库或上传目录。")

    with tempfile.TemporaryDirectory(prefix=".medread-copy-", dir=destination.parent) as temporary:
        stage = Path(temporary) / "data"
        stage.mkdir(mode=0o700)
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as source:
            with closing(sqlite3.connect(stage / "app.db")) as snapshot:
                source.backup(snapshot)
                with snapshot:
                    updated = rewrite_paths(snapshot, uploads, destination / "uploads", restore)
                if snapshot.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise ValueError("SQLite 完整性检查失败。")
        shutil.copytree(uploads, stage / "uploads", ignore=reject_links)
        stage.rename(destination)
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    backup = commands.add_parser("backup")
    backup.add_argument("database", type=Path)
    backup.add_argument("uploads", type=Path)
    backup.add_argument("destination", type=Path)
    restore = commands.add_parser("restore")
    restore.add_argument("bundle", type=Path)
    restore.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "backup":
            count = copy_data(args.database, args.uploads, args.destination, restore=False)
        else:
            count = copy_data(args.bundle / "app.db", args.bundle / "uploads", args.destination, restore=True)
    except (OSError, ValueError, sqlite3.Error) as exc:
        parser.exit(1, f"MedRead data copy failed: {exc}\n")
    print(f"MedRead {args.command} completed; verified {count} file references.")


if __name__ == "__main__":
    main()
