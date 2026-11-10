"""Regression guard: tests must never start a worker against user data."""

import os
from pathlib import Path

from app.config import upload_dir
from app.db import engine


def test_database_and_uploads_are_in_disposable_test_directory():
    root = Path(os.environ["MEDREAD_TEST_ROOT"]).resolve()
    assert Path(engine.url.database).resolve().is_relative_to(root)
    assert upload_dir().is_relative_to(root)
