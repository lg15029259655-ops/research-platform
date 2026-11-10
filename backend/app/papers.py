import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
import shutil
import logging
from difflib import SequenceMatcher
import pymupdf

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .db import SessionLocal
from .models import Message, Paper, PaperImage, ReadingUnit, ResearchArtifact, ResearchWorkspace
from .auth import current_owner
from .services.bailian_service import AIConfigurationError, model_config, stream_completion
from .services.file_service import save_pdf
from .services import file_service
from .services.pdf_service import extract_embedded_images, parse_pdf, render_page_png

router = APIRouter(prefix="/api/papers")
RULES = Path(__file__).parent / "prompts" / "reading_rules.md"
logger = logging.getLogger(__name__)
ACTIONS = {"START", "NEXT", "NAVIGATE", "FIGURE", "WHY_DESIGN", "EVIDENCE", "QUESTION"}
Owner = Depends(current_owner)


def owned_paper(db, paper_id: str, owner: str) -> Paper:
    paper = db.get(Paper, paper_id)
    if paper is None or paper.owner_id != owner:
        raise HTTPException(404, "论文不存在")
    return paper


def paper_data(paper: Paper, units: list[ReadingUnit] | None = None) -> dict:
    data = {"id": paper.id, "title": paper.title, "original_filename": paper.original_filename,
            "current_unit_id": paper.current_unit_id, "status": paper.status,
            "warning": paper.parse_warning,
            "created_at": paper.created_at.isoformat() if paper.created_at else None,
            "last_read_at": paper.last_read_at.isoformat() if paper.last_read_at else None,
            "image_count": len(paper.images),
            "authors": paper.authors, "year": paper.year, "journal": paper.journal,
            "doi": paper.doi, "openalex_id": paper.openalex_id,
            "abstract": paper.abstract, "citation_count": paper.citation_count,
            "oa_pdf_url": paper.oa_pdf_url, "domain": paper.domain,
            "study_type": paper.study_type, "template": paper.template,
            "full_text_available": paper.status == "parsed"}
    if units is not None:
        try:
            with pymupdf.open(paper.local_file_path) as document:
                data["page_count"] = document.page_count
        except Exception:
            data["page_count"] = None
        data["units"] = [{"id": unit.id, "position": unit.position, "kind": unit.kind,
                          "heading": unit.heading, "page_start": unit.page_start,
                          "page_end": unit.page_end,
                          "figure_number": unit.heading.removeprefix("Figure ") if unit.kind == "FIGURE" else None,
                          "actual_pdf_page": unit.page_start if unit.kind == "FIGURE" else None,
                          "caption": unit.source_text.split("\n", 1)[0].removeprefix("图注/表注：")
                          if unit.kind in {"FIGURE", "TABLE"} else None,
                          "evidence_snippet": unit.source_text.split("Results 相关原文：", 1)[-1].split("同页邻近文字：", 1)[0].strip()[:260]
                          if unit.kind in {"FIGURE", "TABLE"} and "Results 相关原文：" in unit.source_text else None}
                         for unit in units]
        data["main_figure_count"] = sum(unit.kind == "FIGURE" for unit in units)
        data["current_stage"] = next((unit.heading for unit in units if unit.id == paper.current_unit_id), None)
    return data


def process_paper(paper_id: str, owner: str, path: str, replace_existing: bool = False) -> None:
    def set_stage(stage: str) -> None:
        with SessionLocal() as db:
            paper = owned_paper(db, paper_id, owner)
            paper.status = stage
            db.commit()

    try:
        parsed = parse_pdf(path, on_stage=set_stage)
        set_stage("images")
        try:
            embedded_images = extract_embedded_images(path)
        except Exception as exc:
            logger.warning("Embedded image extraction failed: %s", type(exc).__name__)
            embedded_images = []
        with SessionLocal() as db:
            paper = owned_paper(db, paper_id, owner)
            metadata_title = paper.title if paper.openalex_id else None
            if replace_existing:
                # Keep the conversation but detach old unit references, which
                # may refer to different content after re-segmentation.
                db.query(Message).filter(Message.paper_id == paper_id).update({Message.reading_unit_id: None})
                db.query(ReadingUnit).filter(ReadingUnit.paper_id == paper_id).delete()
                db.query(PaperImage).filter(PaperImage.paper_id == paper_id).delete()
                paper.current_unit_id = None
                artifacts = db.scalars(select(ResearchArtifact).where(
                    ResearchArtifact.owner_id == owner,
                    ResearchArtifact.kind.in_(["paper_summary", "paper_compare"]))).all()
                for artifact in artifacts:
                    if paper_id in json.loads(artifact.paper_ids_json):
                        payload = json.loads(artifact.payload_json)
                        payload["stale_after_reparse"] = True
                        artifact.payload_json = json.dumps(payload, ensure_ascii=False)
            paper.title = parsed.title
            if not paper.domain:
                from .research import route_research
                routed = route_research(parsed.title, " ".join(item.text[:1800] for item in parsed.units[:3]))
                paper.domain, paper.study_type, paper.template = routed.values()
            mismatch = (metadata_title and parsed.title != "标题未识别（请核对原文）" and
                        SequenceMatcher(None, metadata_title.casefold(), parsed.title.casefold()).ratio() < 0.5)
            paper.parse_warning = " ".join(filter(None, [parsed.warning,
                "上传的 PDF 标题与检索记录可能不一致，请核对原文。" if mismatch else None])) or None
            for position, item in enumerate(parsed.units):
                db.add(ReadingUnit(id=f"{paper_id}:{position}", paper_id=paper_id, position=position,
                                   kind=item.kind, heading=item.heading, page_start=item.page_start,
                                   page_end=item.page_end, source_text=item.text))
            for index, item in enumerate(embedded_images):
                db.add(PaperImage(id=f"{paper_id}:image:{index}", paper_id=paper_id,
                                  page_number=item["page_number"], xref=item["xref"],
                                  local_file_path=item["path"], width=item["width"], height=item["height"]))
            paper.status = "parsed"
            db.commit()
    except Exception as exc:
        logger.warning("PDF parse failed: %s", type(exc).__name__)
        if replace_existing:
            with SessionLocal() as db:
                paper = owned_paper(db, paper_id, owner)
                paper.status = "parsed"
                paper.parse_warning = "重新解析失败，已保留上一次阅读记录。请检查 PDF 文件。"
                db.commit()
        else:
            set_stage("failed")


@router.post("")
async def upload_paper(background_tasks: BackgroundTasks, file: UploadFile = File(...),
                       deferred: bool = False, owner: str = Owner):
    paper_id = str(uuid4())
    original, path, size, digest = await save_pdf(file, owner, paper_id)
    with SessionLocal() as db:
        paper = Paper(id=paper_id, owner_id=owner, title="正在解析论文",
                      original_filename=original, stored_filename=Path(path).name,
                      local_file_path=path, mime_type="application/pdf", file_size_bytes=size,
                      sha256=digest, status="uploaded")
        db.add(paper)
        db.commit()
    if deferred:
        background_tasks.add_task(process_paper, paper_id, owner, path)
        return {"id": paper_id, "status": "uploaded"}
    await run_in_threadpool(process_paper, paper_id, owner, path)
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        if paper.status == "failed":
            raise HTTPException(400, "PDF 解析失败，请重试")
        units = db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id == paper_id).order_by(ReadingUnit.position)).all()
        return paper_data(paper, units)


@router.post("/{paper_id}/attach")
async def attach_pdf(paper_id: str, background_tasks: BackgroundTasks,
                     file: UploadFile = File(...), owner: str = Owner):
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        if paper.status not in {"metadata_only", "failed"}:
            raise HTTPException(409, "这篇论文已有 PDF")
    original, path, size, digest = await save_pdf(file, owner, paper_id)
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        old_path = paper.local_file_path
        db.query(ReadingUnit).filter(ReadingUnit.paper_id == paper_id).delete()
        db.query(PaperImage).filter(PaperImage.paper_id == paper_id).delete()
        paper.current_unit_id = None
        paper.original_filename = original
        paper.stored_filename = Path(path).name
        paper.local_file_path = path
        paper.mime_type = "application/pdf"
        paper.file_size_bytes = size
        paper.sha256 = digest
        paper.status = "uploaded"
        db.commit()
    if old_path and old_path != path and Path(old_path).resolve().parent == (file_service.upload_dir() / owner / paper_id).resolve():
        Path(old_path).unlink(missing_ok=True)
    background_tasks.add_task(process_paper, paper_id, owner, path)
    return {"id": paper_id, "status": "uploaded"}


@router.post("/{paper_id}/reparse")
def reparse_paper(paper_id: str, background_tasks: BackgroundTasks, owner: str = Owner):
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        if paper.status != "parsed" or not paper.local_file_path or not Path(paper.local_file_path).is_file():
            raise HTTPException(422, "当前 PDF 无法重新解析")
        path = paper.local_file_path
        paper.status = "uploaded"
        db.commit()
    background_tasks.add_task(process_paper, paper_id, owner, path, True)
    return {"id": paper_id, "status": "uploaded"}


@router.get("")
def list_papers(owner: str = Owner):
    with SessionLocal() as db:
        papers = db.scalars(select(Paper).options(selectinload(Paper.images)).where(Paper.owner_id == owner).order_by(Paper.created_at.desc())).all()
        return [paper_data(paper) for paper in papers]


@router.get("/{paper_id}")
def get_paper(paper_id: str, owner: str = Owner):
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        units = db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id == paper_id).order_by(ReadingUnit.position)).all()
        messages = db.scalars(select(Message).where(Message.paper_id == paper_id).order_by(Message.created_at, Message.id)).all()
        data = paper_data(paper, units)
        data["messages"] = [{"id": item.id, "role": item.role, "content": item.content,
                             "action": item.action, "reading_unit_id": item.reading_unit_id,
                             "visual_verified": item.visual_verified,
                             "created_at": item.created_at.isoformat() if item.created_at else None} for item in messages]
        return data


@router.get("/{paper_id}/status")
def paper_status(paper_id: str, owner: str = Owner):
    """Lightweight parse progress; do not reopen PDFs or load history per poll."""
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        return {"id": paper.id, "status": paper.status, "warning": paper.parse_warning}


@router.get("/{paper_id}/file")
def get_file(paper_id: str, owner: str = Owner):
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        if paper.status != "parsed":
            raise HTTPException(422, "请先上传全文 PDF")
        path = paper.local_file_path
    return FileResponse(path, media_type="application/pdf", filename="paper.pdf", content_disposition_type="inline")


@router.get("/{paper_id}/pages/{page_number}/thumbnail")
def page_thumbnail(paper_id: str, page_number: int, owner: str = Owner):
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        if paper.status != "parsed":
            raise HTTPException(422, "请先上传全文 PDF")
        path = paper.local_file_path
    try:
        image = render_page_png(path, page_number, max_dimension=760)
    except Exception as exc:
        logger.warning("PDF thumbnail failed: %s", type(exc).__name__)
        raise HTTPException(404, "页面图像暂时无法读取") from exc
    return Response(image, media_type="image/png", headers={"Cache-Control": "private, max-age=300"})


@router.get("/{paper_id}/search")
def search_paper(paper_id: str, q: str, owner: str = Owner):
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        if paper.status != "parsed":
            raise HTTPException(422, "请先上传全文 PDF")
    query = q.strip().lower()
    if len(query) < 2:
        return []
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        hits = []
        with pymupdf.open(paper.local_file_path) as document:
            for number, page in enumerate(document, 1):
                content = page.get_text("text")
                index = content.lower().find(query)
                if index >= 0:
                    hits.append({"page": number,
                                 "snippet": content[max(0, index - 60):index + len(query) + 100].replace("\n", " ")})
        return hits[:30]


@router.get("/{paper_id}/manifest")
def get_manifest(paper_id: str, owner: str = Owner):
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        units = db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id == paper_id).order_by(ReadingUnit.position)).all()
        return paper_data(paper, units)


@router.delete("/{paper_id}")
def delete_paper(paper_id: str, owner: str = Owner):
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        folder = (file_service.upload_dir() / owner / paper_id).resolve()
        if folder.parent != (file_service.upload_dir() / owner).resolve() or (paper.local_file_path and Path(paper.local_file_path).resolve().parent != folder):
            raise HTTPException(500, "论文文件路径异常")
        artifacts = db.scalars(select(ResearchArtifact).where(ResearchArtifact.owner_id == owner)).all()
        for artifact in artifacts:
            if paper_id in json.loads(artifact.paper_ids_json):
                db.delete(artifact)
        workspace = db.scalar(select(ResearchWorkspace).where(ResearchWorkspace.owner_id == owner))
        if workspace:
            selected = json.loads(workspace.selected_paper_ids_json)
            workspace.selected_paper_ids_json = json.dumps([item for item in selected if item != paper_id])
            if workspace.core_paper_id == paper_id:
                workspace.core_paper_id = None
            if workspace.synthesis_id and any(
                artifact.id == workspace.synthesis_id and paper_id in json.loads(artifact.paper_ids_json)
                for artifact in artifacts
            ):
                workspace.synthesis_id = None
        db.delete(paper)
        db.commit()
    shutil.rmtree(folder, ignore_errors=True)
    return {"deleted": True}


class ChatRequest(BaseModel):
    action: str
    message: str | None = None
    unit_id: str | None = None


def choose_unit(units: list[ReadingUnit], current_id: str | None, action: str, target_id: str | None = None) -> ReadingUnit:
    current = next((unit for unit in units if unit.id == current_id), None)
    if action == "START":
        # The first click is one reading step: interpret the title, then examine
        # the abstract. Keep the manifest units separate for later navigation.
        return current or next((unit for unit in units if unit.kind == "ABSTRACT"), units[0])
    if action == "NEXT":
        if current is None:
            return units[0]
        return units[min(current.position + 1, len(units) - 1)]
    if action == "NAVIGATE":
        target = next((unit for unit in units if unit.id == target_id), None)
        if target is None:
            raise HTTPException(400, "阅读单元不存在")
        return target
    if action == "FIGURE":
        if current and current.kind == "FIGURE":
            return current
        figures = [unit for unit in units if unit.kind == "FIGURE"]
        if figures:
            return min(figures, key=lambda item: abs(item.position - (current.position if current else 0)))
    return current or units[0]


def request_text(action: str, message: str | None, unit: ReadingUnit) -> str:
    if action in {"START", "NEXT", "NAVIGATE"}:
        if unit.kind == "TITLE":
            return ("这是严格的标题识读任务，只输出两项：①标题字面写了什么；②读摘要时要核对什么。"
                    "除标题原词外，不得出现任何具体技术、模型、领域、研究任务、数据集、实验结果、其他论文或作者意图；"
                    "不得举例或引用你已知的这篇论文内容。标题笼统时明确说无法判断。总共不超过 120 个汉字。")
        if unit.kind == "RECAP":
            return ("请基于已提供的论文证据完成全文复盘。严格按以下标签分段："
                    "【研究问题】【研究背景】【研究思路】【核心发现】【关键 Figure 或 Table】"
                    "【核心机制或证据关系】【创新点】【局限性】【下一步研究】。"
                    "最后用【关系图】列出最多 5 条『节点 -> 节点』关系；证据不足时写『证据不足』，不得编造机制。")
        return f"请只精读当前单元：{unit.heading}。不要推进到下一单元。"
    if action == "FIGURE":
        return f"请结合实际页面图像与图注，详细解释 {unit.heading}。不推进阅读位置。"
    if action == "WHY_DESIGN":
        return "为什么采用当前研究设计、模型、分组、对照和检测方法？不推进阅读位置。"
    if action == "EVIDENCE":
        return "当前结果能证明什么、不能证明什么？有哪些替代解释和待补的实验？不推进阅读位置。"
    return (message or "").strip()


def display_request(action: str, message: str | None, heading: str) -> str:
    labels = {"START": "开始精读", "NEXT": f"继续阅读：{heading}",
              "NAVIGATE": f"跳转并精读：{heading}", "FIGURE": "详细解释当前 Figure",
              "WHY_DESIGN": "为什么这样设计？", "EVIDENCE": "当前结果能证明什么？"}
    return labels.get(action, (message or "").strip())


@router.post("/{paper_id}/chat")
async def chat(paper_id: str, request: ChatRequest, owner: str = Owner):
    if request.action not in ACTIONS or (request.action == "QUESTION" and not (request.message or "").strip()):
        raise HTTPException(400, "无效的精读操作")
    with SessionLocal() as db:
        paper = owned_paper(db, paper_id, owner)
        try:
            model_config(False)
        except AIConfigurationError as exc:
            raise HTTPException(503, "AI 服务暂时不可用，请重试") from exc
        units = db.scalars(select(ReadingUnit).where(ReadingUnit.paper_id == paper_id).order_by(ReadingUnit.position)).all()
        if not units:
            raise HTTPException(422, "PDF 未提取到可阅读内容")
        unit = choose_unit(units, paper.current_unit_id, request.action, request.unit_id)
        if request.action == "FIGURE" and unit.kind != "FIGURE":
            raise HTTPException(422, "未识别到 Figure 图注，无法可靠讲解图像")
        path = paper.local_file_path
        history = []
        if unit.kind != "TITLE" and request.action in {"QUESTION", "FIGURE", "WHY_DESIGN", "EVIDENCE"}:
            history = db.scalars(select(Message).where(
                Message.paper_id == paper_id, Message.reading_unit_id == unit.id
            ).order_by(Message.created_at.desc()).limit(8)).all()
        context = unit.source_text[:7500]
        first_abstract = request.action == "START" and paper.current_unit_id is None and unit.kind == "ABSTRACT"
        if first_abstract:
            title_unit = next((item for item in units if item.kind == "TITLE"), None)
            context = f"标题原文：{title_unit.source_text[:1000] if title_unit else paper.title}\n摘要原文：{context}"
        if unit.kind == "RECAP":
            context = "\n".join(f"{item.heading}: {item.source_text[:900]}" for item in units if item.kind != "RECAP")[:11000]
        elif request.action == "QUESTION":
            query = (request.message or "").lower()
            related = [item for item in units if item.id != unit.id and (query in item.heading.lower() or query in item.source_text.lower())]
            context += "\n\n相关原文：\n" + "\n".join(item.source_text[:1200] for item in related[:2])
        prompt = ("这是起读单元，请依次讲解题目与摘要。先用 1—2 句解释标题明确写出的研究对象和问题，"
                  "再依据提供的摘要解释：科学问题与研究动机、研究设计或关键比较、主要结果、结论边界、"
                  "接下来读引言和方法时需要核对的关键点。区分摘要明说的事实与尚待全文验证的推断；"
                  "不能引入摘要之外的具体结果。只讲题目与摘要，不推进引言。") if first_abstract else request_text(request.action, request.message, unit)
        user_visible_request = "开始精读：题目与摘要" if first_abstract else display_request(request.action, request.message, unit.heading)
        is_figure = unit.kind == "FIGURE"
        selected_id = unit.id
        heading = unit.heading
        page = unit.page_start
        research_profile = "" if unit.kind == "TITLE" else f"领域：{paper.domain or '未确认'}；研究类型：{paper.study_type or '未确认'}；模板：{paper.template or '通用'}。"
    system = RULES.read_text(encoding="utf-8")
    source = f"{research_profile}\n当前单元：{heading}；PDF 页码：{page or '未知'}。\nPDF 提取原文/图注：\n{context or '未能提取当前单元文字。请明确说明无法读取。'}"
    messages = [{"role": "system", "content": system + "\n\n" + source}]
    for item in reversed(history):
        messages.append({"role": item.role, "content": item.content[:2500]})
    visual_input_ready = False
    if is_figure and page:
        try:
            png = await run_in_threadpool(render_page_png, path, page)
            visual_input_ready = bool(png)
        except Exception as exc:
            logger.warning("Figure page render failed: %s", type(exc).__name__)
            visual_input_ready = False
    if visual_input_ready:
        content = [{"type": "text", "text": prompt},
                   {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode("ascii")}}]
    else:
        content = prompt
        if is_figure:
            messages[0]["content"] += "\n当前未提供图像。仅可根据正文和图注解释；不得说『从图中可以看到』或暗示已核对视觉内容。"
    messages.append({"role": "user", "content": content})

    async def events():
        answer = ""
        verified = False
        try:
            if request.action in {"START", "NEXT", "NAVIGATE"}:
                yield f"data: {json.dumps({'type': 'selected', 'unit_id': selected_id, 'page': page, 'heading': '题目与摘要' if first_abstract else heading}, ensure_ascii=False)}\n\n"
            if visual_input_ready:
                try:
                    async for delta in stream_completion(messages, vision=True):
                        answer += delta
                        yield f"data: {json.dumps({'type': 'delta', 'content': delta}, ensure_ascii=False)}\n\n"
                    if not answer.strip():
                        raise RuntimeError("视觉模型未返回内容")
                    verified = True
                except Exception as exc:
                    logger.warning("Visual completion failed; using text fallback: %s", type(exc).__name__)
                    answer = ""
                    messages[0]["content"] += "\n视觉调用失败。仅可根据正文和图注解释；不得声称看到了图像。"
                    messages[-1] = {"role": "user", "content": prompt}
                    yield 'data: {"type":"reset"}\n\n'
            if not verified:
                async for delta in stream_completion(messages, vision=False):
                    answer += delta
                    yield f"data: {json.dumps({'type': 'delta', 'content': delta}, ensure_ascii=False)}\n\n"
            if not answer.strip():
                raise RuntimeError("模型没有返回可用文字")
            with SessionLocal() as db:
                paper = owned_paper(db, paper_id, owner)
                db.add(Message(id=str(uuid4()), paper_id=paper_id, role="user", content=user_visible_request,
                               action=request.action, reading_unit_id=selected_id))
                db.add(Message(id=str(uuid4()), paper_id=paper_id, role="assistant", content=answer,
                               action=request.action, reading_unit_id=selected_id,
                               visual_verified=verified))
                if request.action in {"START", "NEXT", "NAVIGATE"}:
                    paper.current_unit_id = selected_id
                paper.last_read_at = datetime.now(timezone.utc)
                db.commit()
            yield f"data: {json.dumps({'type': 'done', 'current_unit_id': selected_id if request.action in {'START', 'NEXT', 'NAVIGATE'} else None, 'visual_verified': verified}, ensure_ascii=False)}\n\n"
        except Exception as exc:
            logger.warning("Paper AI request failed: %s", type(exc).__name__)
            yield f"data: {json.dumps({'type': 'error', 'message': 'AI 服务暂时不可用，请重试'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
