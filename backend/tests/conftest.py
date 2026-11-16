"""Keep automated tests independent of real papers, jobs and uploads.

This module is imported by pytest before application modules construct the
SQLAlchemy engine. The disposable directory belongs only to this test process.
"""

import os
import sys
import tempfile
from pathlib import Path


_test_directory = tempfile.TemporaryDirectory(prefix="medread-pytest-")
_test_root = Path(_test_directory.name)
os.environ["MEDREAD_TEST_ROOT"] = str(_test_root)
os.environ["DATABASE_URL"] = "sqlite:///" + (_test_root / "test.db").as_posix()
os.environ["UPLOAD_DIR"] = str(_test_root / "uploads")
os.environ["PRECOMPUTE_ON_PARSE"] = "0"


def pytest_unconfigure(config):
    # Windows cannot remove a SQLite file while pooled connections are open.
    db_module = sys.modules.get("app.db")
    if db_module is not None:
        db_module.engine.dispose()
    _test_directory.cleanup()
