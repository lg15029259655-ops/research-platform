import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


def local_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else BACKEND_DIR / path


def database_url() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///./data/app.db")
    prefix = "sqlite:///"
    if url.startswith(prefix):
        return prefix + local_path(url[len(prefix):]).resolve().as_posix()
    return url


def upload_dir() -> Path:
    return local_path(os.getenv("UPLOAD_DIR", "./data/uploads")).resolve()


def max_pdf_bytes() -> int:
    return int(os.getenv("MAX_PDF_SIZE_MB", "100")) * 1024 * 1024


# ---------------------------------------------------------------------------
# AI 任务与延迟治理相关配置
# ---------------------------------------------------------------------------

def thinking_budget() -> int | None:
    """思考 token 预算；未配置则沿用模型默认（= 不限制）。

    只在回归集验证"人工盲评不下降"后才允许通过 env 打开，见 docs/architecture-jobs.md。
    """
    raw = os.getenv("BAILIAN_THINKING_BUDGET", "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def precompute_enabled() -> bool:
    """论文解析完成后是否自动预生成 X-Ray / 思维导图（默认关闭，避免测试与额度意外消耗）。"""
    return os.getenv("PRECOMPUTE_ON_PARSE", "").strip() in {"1", "true", "True"}


def ai_job_deadline() -> float:
    return float(os.getenv("AI_JOB_DEADLINE_SECONDS", "600"))


def max_ai_concurrency() -> int:
    return max(1, int(os.getenv("AI_MAX_CONCURRENCY", "2")))


def max_ai_per_owner() -> int:
    return max(1, int(os.getenv("AI_MAX_PER_OWNER", "1")))
