import asyncio
import os
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from .db import Base, SessionLocal, engine
from . import models  # noqa: F401 - register tables
from .services.bailian_service import AIConfigurationError, stream_completion, text_config
from .papers import router as papers_router
from .papers import pending_parse_tickets, recover_pending_parses
from .research import route_research, router as research_router
from .workspace import router as workspace_router
from .auth import anonymous_session
from .jobs.router import router as jobs_router
from .jobs.worker import start_worker, stop_worker
from .jobs.handlers import register_all


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Add nullable metadata columns to existing local SQLite databases without
    # discarding the user's papers or reading history.
    with engine.begin() as connection:
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(papers)")}
        additions = {
            "authors": "TEXT", "year": "INTEGER", "journal": "VARCHAR(500)",
            "doi": "VARCHAR(500)", "openalex_id": "VARCHAR(100)",
            "abstract": "TEXT", "citation_count": "INTEGER", "oa_pdf_url": "TEXT",
            "domain": "VARCHAR(50)", "study_type": "VARCHAR(80)",
            "template": "VARCHAR(80)",
            "parse_token": "VARCHAR(36)", "parse_heartbeat": "DATETIME",
            "source_sha256": "VARCHAR(64)", "content_revision": "VARCHAR(36)",
        }
        if columns:
            for name, kind in additions.items():
                if name not in columns:
                    connection.exec_driver_sql(f"ALTER TABLE papers ADD COLUMN {name} {kind}")
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        for paper in db.query(models.Paper).filter(models.Paper.domain.is_(None)).all():
            routed = route_research(paper.title, paper.abstract or "")
            paper.domain = routed["domain"]
            paper.study_type = routed["study_type"]
            paper.template = routed["template"]
        db.commit()
    stopping = asyncio.Event()
    tickets = await run_in_threadpool(pending_parse_tickets)
    register_all()
    start_worker()
    recovery = asyncio.create_task(recover_pending_parses(tickets, stopping))
    try:
        yield
    finally:
        stopping.set()
        await recovery
        await stop_worker()


app = FastAPI(title="科研工作台 API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)
app.middleware("http")(anonymous_session)
app.include_router(papers_router)
app.include_router(research_router)
app.include_router(workspace_router)
app.include_router(jobs_router)


@app.get("/api/health")
def health():
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}


@app.get("/api/session")
def session_status():
    # The anonymous-session middleware sets the persistent cookie when needed.
    return {"ready": True}


@app.get("/api/ai/status")
def ai_status():
    fields = ("BAILIAN_API_KEY", "BAILIAN_BASE_URL", "BAILIAN_TEXT_MODEL", "BAILIAN_VISION_MODEL")
    missing = [name for name in fields if not os.getenv(name)]
    return {"configured": not missing, "missing": missing}


class ProbeRequest(BaseModel):
    message: str = "请用一句话回答：连接测试成功。"


@app.post("/api/ai/probe")
async def probe(request: ProbeRequest):
    try:
        text_config()
    except AIConfigurationError as exc:
        raise HTTPException(status_code=503, detail="AI 服务暂时不可用，请重试") from exc

    async def events():
        try:
            async for chunk in stream_completion([{"role": "user", "content": request.message[:500]}]):
                yield f"data: {json.dumps({'type': 'delta', 'content': chunk}, ensure_ascii=False)}\n\n"
            yield 'data: {"type":"done"}\n\n'
        except Exception:
            yield f"data: {json.dumps({'type': 'error', 'message': 'AI 服务暂时不可用，请重试'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})
