"""Opaque, persistent anonymous browser sessions."""

import hashlib
import os
import secrets
import threading
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select

from .db import SessionLocal
from .models import User

COOKIE_NAME = "medread_session"
COOKIE_AGE = 180 * 24 * 60 * 60
_demo_lock = threading.Lock()


def session_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def current_owner(request: Request) -> str:
    return request.state.owner_id


def _resolve_owner(token: str) -> tuple[str, str | None]:
    user = None
    if len(token) == 43:
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.session_hash == session_hash(token)))

    new_token = None
    if user is None:
        new_token = secrets.token_urlsafe(32)
        with SessionLocal() as db:
            user = User(id=str(uuid4()), session_hash=session_hash(new_token))
            db.add(user)
            db.flush()
            from .services.demo_service import ensure_demo
            ensure_demo(db, user.id)
            db.commit()
    elif os.getenv("DEMO_SEED_DIR", "").strip():
        # Multiple parallel page requests must not create duplicate examples.
        from .services.demo_service import ensure_demo
        with _demo_lock, SessionLocal() as db:
            ensure_demo(db, user.id)
            db.commit()
    return user.id, new_token


async def anonymous_session(request: Request, call_next):
    if request.method == "OPTIONS" or not request.url.path.startswith("/api/"):
        return await call_next(request)
    origin = request.headers.get("origin")
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and origin and origin != os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000"):
        return JSONResponse({"detail": "请求来源无效"}, status_code=403)

    token = request.cookies.get(COOKIE_NAME, "")
    owner_id, new_token = await run_in_threadpool(_resolve_owner, token)
    request.state.owner_id = owner_id
    response = await call_next(request)
    if new_token:
        response.set_cookie(
            COOKIE_NAME, new_token, max_age=COOKIE_AGE, httponly=True,
            secure=request.url.scheme == "https", samesite="lax", path="/",
        )
    return response
