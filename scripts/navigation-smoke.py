"""Browser regression for an isolated MedRead preview with the demo seed enabled."""

import argparse
import json
import re
from urllib.parse import parse_qs, urlencode, urlsplit

from playwright.sync_api import expect, sync_playwright


def background_jobs(browser, frontend, backend):
    context = browser.new_context()
    page = context.new_page()
    page.set_default_timeout(12000)
    page.goto(f"{frontend}/synthesis")
    expect(page.locator(".synthesisResult")).to_be_visible()
    workspace = context.request.get(f"{backend}/api/workspace").json()
    artifact_url = f"{backend}/api/research/artifacts?kind=paper_compare&artifact_id={workspace['synthesis_id']}"
    artifact = context.request.get(artifact_url).json()[0]
    artifact["payload"]["consensus"] = ["已恢复后台综合结果"]
    status = {"comparison": "running", "design": "running"}
    submissions = []
    cancellations = []
    design_offline = False

    def jobs_fixture(route):
        url = urlsplit(route.request.url)
        method = route.request.method
        if method == "POST":
            kind = route.request.post_data_json["kind"]
            submissions.append(kind)
            job_id = "comparison" if kind == "compare" else "design"
            route.fulfill(status=202, json={"id": job_id, "kind": kind, "status": "queued"})
            return
        parts = url.path.split("/")
        job_id = parts[3]
        if method == "DELETE":
            cancellations.append(job_id)
            if len(cancellations) == 1:
                route.fulfill(status=503, json={})
                return
            route.fulfill(json={"canceled": True})
            return
        if job_id == "design" and design_offline:
            route.abort("internetdisconnected")
            return
        snapshot = {
            "id": job_id, "kind": "compare" if job_id == "comparison" else "design", "status": status[job_id],
            "stage_label": "正在进行后台综合" if job_id == "comparison" else "正在进行后台设计",
            "result": artifact if job_id == "comparison" and status[job_id] == "done" else None,
        }
        if url.path.endswith("/events"):
            route.fulfill(content_type="text/event-stream",
                          body="event: snapshot\ndata: " + json.dumps(snapshot) + "\n\n")
        else:
            route.fulfill(json=snapshot)

    context.route(re.compile(rf"^{re.escape(backend)}/api/jobs(?:/|$)"), jobs_fixture)
    page.get_by_role("button", name="更换对比论文").click()
    boxes = page.locator(".selectionList input")
    expect(boxes).to_have_count(3)
    if boxes.nth(2).is_checked():
        boxes.nth(2).uncheck()
    else:
        boxes.nth(2).check()
    page.get_by_role("button", name="按当前选择重新综合").click()
    expect(page.get_by_text("正在进行后台综合")).to_be_visible()
    page.locator(".researchNav nav").get_by_role("link", name="深度精读").click()
    expect(page.locator(".reader")).to_be_visible()
    page.locator(".researchNav nav").get_by_role("link", name="文献综合").click()
    expect(page.get_by_text("正在进行后台综合")).to_be_visible()
    assert submissions == ["compare"] and not cancellations

    status["comparison"] = "done"
    page.reload()
    expect(page.locator(".compareTakeaways p").filter(has_text="已恢复后台综合结果")).to_be_visible()
    assert submissions == ["compare"] and not cancellations

    page.locator(".researchNav nav").get_by_role("link", name="科研设计").click()
    page.get_by_label("我的研究想法").fill("A new design for the background job check")
    page.get_by_label("约束条件（可选）").fill("Six weeks")
    page.get_by_role("button", name="生成研究设计").click()
    expect(page.get_by_text("正在进行后台设计")).to_be_visible()
    page.locator(".researchNav nav").get_by_role("link", name="科研发现").click()
    expect(page.get_by_role("textbox", name="论文检索")).to_be_visible()
    page.locator(".researchNav nav").get_by_role("link", name="科研设计").click()
    expect(page.get_by_text("正在进行后台设计")).to_be_visible()
    expect(page.get_by_label("我的研究想法")).to_have_value("A new design for the background job check")
    expect(page.get_by_label("约束条件（可选）")).to_have_value("Six weeks")
    assert submissions == ["compare", "design"] and not cancellations
    design_offline = True
    expect(page.get_by_text("连接暂时中断，正在重新读取任务状态。")).to_be_visible(timeout=12000)
    design_offline = False
    expect(page.get_by_text("连接暂时中断，正在重新读取任务状态。")).to_have_count(0, timeout=12000)
    cancel = page.locator(".jobProgress").get_by_role("button", name="取消", exact=True)
    cancel.click()
    expect(page.get_by_role("alert").filter(has_text="暂未确认取消")).to_be_visible()
    expect(page.get_by_text("正在进行后台设计")).to_be_visible()
    cancel.click()
    expect(page.get_by_role("button", name="正在取消…")).to_be_disabled()
    status["design"] = "canceled"
    expect(page.locator(".jobProgress")).to_have_count(0)
    expect(page.get_by_text("任务已取消。", exact=True)).to_be_visible()
    assert cancellations == ["design", "design"]
    context.close()


def manual_design_draft(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.goto(f"{frontend}/design")
    editor = page.locator(".design-step-editor")
    editor.get_by_role("button", name="手动添加或删除实验步骤").click()
    step = editor.get_by_label("新步骤名称")
    notes = editor.get_by_label("目的或操作说明（可选）")
    step.fill("Review the baseline evidence")
    notes.fill("Keep this step in the local draft before creating a new version.")
    save = editor.get_by_role("button", name="保存为新版本")
    expect(save).to_be_disabled()
    page.reload()
    expect(step).to_have_value("Review the baseline evidence")
    expect(notes).to_have_value("Keep this step in the local draft before creating a new version.")
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2")
    assert editor.locator(".dse-list button").first.evaluate(
        "(button) => button.clientHeight >= 42 && getComputedStyle(button).whiteSpace === 'nowrap'"
    )
    editor.get_by_role("button", name="加入草稿").click()
    page.reload()
    expect(editor.get_by_role("textbox", name="步骤名称：Review the baseline evidence", exact=True)).to_be_visible()
    expect(save).to_be_enabled()

    save_url = f"{backend}/api/research/design/manual"
    context.route(save_url, lambda route: route.fulfill(status=503, json={"detail": "步骤保存暂不可用"}), times=1)
    save.click()
    expect(editor.get_by_role("alert").filter(has_text="步骤保存暂不可用")).to_be_visible()
    expect(editor.get_by_role("textbox", name="步骤名称：Review the baseline evidence", exact=True)).to_be_visible()
    with page.expect_response(lambda response: response.url == save_url) as saved:
        save.click()
    assert saved.value.ok, saved.value.text()
    expect(page.locator(".versionBar button.active")).to_contain_text("手动编辑")
    page.reload()
    editor.get_by_role("button", name="手动添加或删除实验步骤").click()
    expect(editor.get_by_role("textbox", name="步骤名称：Review the baseline evidence", exact=True)).to_be_visible()
    expect(save).to_be_disabled()
    context.close()


def reader_reparse(browser, frontend, backend):
    context = browser.new_context()
    page = context.new_page()
    assert context.request.get(f"{backend}/api/session").ok
    workspace = context.request.get(f"{backend}/api/workspace").json()
    paper_id = workspace["core_paper_id"]
    detail_url = f"{backend}/api/papers/{paper_id}"
    prior = context.request.get(detail_url).json()
    context.route(detail_url, lambda route: route.fulfill(json={**prior, "warning": "未可靠识别论文章节"}), times=1)
    status_url = f"{detail_url}/status"
    status_requests = []
    context.route(status_url, lambda route: status_requests.append(route))
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto(f"{frontend}/read?paper={paper_id}")
    with page.expect_response(f"{detail_url}/reparse") as requested:
        page.get_by_role("button", name="重新识别当前 PDF").click()
    assert requested.value.ok, requested.value.text()
    expect(page.get_by_text("PDF 正在解析。", exact=False)).to_be_visible()
    expect(page.locator(".pdfCanvas")).to_have_count(0)
    if status_requests:
        status_requests[0].fulfill(json={"status": "reading"})
    context.unroute(status_url)
    page.reload()
    expect(page.locator(".pdfCanvas canvas")).to_be_visible(timeout=15000)
    after = context.request.get(detail_url).json()
    assert after["status"] == "parsed"
    assert [item["id"] for item in after["messages"]] == [item["id"] for item in prior["messages"]]
    context.close()


def shared_selection(browser, frontend, backend):
    context = browser.new_context()
    first = context.new_page()
    first.goto(f"{frontend}/synthesis")
    first.get_by_role("button", name="更换对比论文").click()
    second = context.new_page()
    second.goto(f"{frontend}/synthesis")
    second.get_by_role("button", name="更换对比论文").click()
    first_boxes = first.locator(".selectionList input")
    second_boxes = second.locator(".selectionList input")
    expect(first.locator(".selectionList input:checked")).to_have_count(3)
    expect(second.locator(".selectionList input:checked")).to_have_count(3)

    url = f"{backend}/api/workspace/selection"
    held = []
    first.route(url, lambda route: held.append(route), times=1)
    with first.expect_request(url):
        first_boxes.nth(0).uncheck()
    expect(first.get_by_text("正在保存论文选择…")).to_be_visible()
    expect(first.locator("button.primaryButton").first).to_be_disabled()
    second_boxes.nth(1).uncheck()
    expect(first_boxes.nth(1)).not_to_be_checked()
    held[0].continue_()
    expect(first.locator(".selectionList input:checked")).to_have_count(1)
    expect(second.locator(".selectionList input:checked")).to_have_count(1)
    expect(first.get_by_text("正在保存论文选择…")).to_have_count(0)
    workspace = context.request.get(f"{backend}/api/workspace").json()
    assert len(workspace["selected_paper_ids"]) == 1
    assert not first_boxes.nth(0).is_checked() and not second_boxes.nth(0).is_checked()
    assert not first_boxes.nth(1).is_checked() and not second_boxes.nth(1).is_checked()

    first.route(url, lambda route: route.fulfill(status=503, json={}), times=1)
    first_boxes.nth(0).click()
    expect(first.get_by_role("alert").filter(has_text="论文选择未确认保存")).to_be_visible()
    expect(first_boxes.nth(0)).not_to_be_checked()
    expect(first.get_by_text("正在保存论文选择…")).to_have_count(0)
    first_boxes.nth(0).check()
    expect(second_boxes.nth(0)).to_be_checked()
    expect(first.get_by_role("alert").filter(has_text="论文选择未确认保存")).to_have_count(0)

    paper_id = workspace["selected_paper_ids"][0]
    pdf = context.request.get(f"{backend}/api/papers/{paper_id}/file")
    uploaded = context.request.post(f"{backend}/api/papers", multipart={
        "file": {"name": "new-selection.pdf", "mimeType": "application/pdf", "buffer": pdf.body()},
    })
    assert uploaded.ok, uploaded.text()
    second.goto(f"{frontend}/read?paper={uploaded.json()['id']}")
    second.get_by_role("button", name="加入待综合").click()
    expect(first.locator(".selectionList input")).to_have_count(4)
    expect(first.locator(".selectionList input:checked")).to_have_count(3)
    context.close()


def compact_reading(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    page = context.new_page()
    page.goto(f"{frontend}/read")
    pdf_tab = page.get_by_role("tab", name="原文 PDF", exact=True)
    chat_tab = page.get_by_role("tab", name="AI 讲解", exact=True)
    drawer = page.get_by_role("dialog", name="论文库")
    library_toggle = page.get_by_role("button", name="展开论文库")
    expect(pdf_tab).to_have_attribute("aria-selected", "true")
    expect(drawer).to_have_count(0)
    expect(page.locator(".pdfCanvas canvas")).to_be_in_viewport()
    expect(page.locator(".chatControls")).to_have_count(0)
    toolbar = page.locator(".pageTools")
    toolbar.get_by_role("button", name="放大 PDF").click()
    pdf_search = page.get_by_role("textbox", name="在 PDF 内搜索文字")
    pdf_search.fill("baseline")
    expect(toolbar).to_contain_text("115%")
    pdf_page = toolbar.locator("span").first.inner_text()

    pdf_tab.focus()
    page.keyboard.press("ArrowRight")
    expect(chat_tab).to_be_focused()
    expect(chat_tab).to_have_attribute("aria-selected", "true")
    expect(page.get_by_role("textbox", name="提出你的科研问题")).to_be_in_viewport()
    expect(page.locator(".pdfColumn")).to_be_hidden()
    messages = page.locator(".messages")
    messages.evaluate("(node) => { node.scrollTop = 260; node.dataset.probe = 'retained'; }")
    chat_scroll = messages.evaluate("(node) => node.scrollTop")
    assert chat_scroll > 0

    pdf_tab.click()
    expect(toolbar).to_contain_text("115%")
    expect(toolbar.locator("span").first).to_have_text(pdf_page)
    expect(pdf_search).to_have_value("baseline")
    chat_tab.click()
    expect(messages).to_have_attribute("data-probe", "retained")
    assert abs(messages.evaluate("(node) => node.scrollTop") - chat_scroll) <= 1

    library_toggle.click()
    expect(drawer).to_be_visible()
    expect(drawer.get_by_role("button", name="关闭论文库")).to_be_focused()
    for name in ("上传 PDF", "关闭论文库"):
        button = drawer.get_by_role("button", name=name)
        assert button.evaluate("(element) => element.getBoundingClientRect().height >= 44"), name
    page.keyboard.press("Escape")
    expect(drawer).to_have_count(0)
    expect(library_toggle).to_be_focused()
    library_toggle.click()
    current = parse_qs(urlsplit(page.url).query)["paper"][0]
    papers = context.request.get(f"{backend}/api/papers").json()
    other = next(item for item in papers if item["id"] != current)
    search = drawer.get_by_role("searchbox", name="搜索论文库")
    search.fill("no matching bibliography")
    expect(drawer.get_by_text("没有匹配的论文。试试换个关键词。")).to_be_visible()
    search.fill(other["original_filename"])
    expect(drawer.locator(".paperItem")).to_have_count(1)
    drawer.locator(".paperItem").click()
    expect(drawer).to_have_count(0)
    expect(page.get_by_role("heading", name=other["title"], exact=True)).to_be_visible()

    page.set_viewport_size({"width": 320, "height": 675})
    pdf_tab.click()
    expect(page.locator(".pdfToolbar")).to_be_visible()
    assert page.evaluate(
        "() => { const reader = document.querySelector('.reader'); return reader.scrollWidth <= reader.clientWidth + 2; }"
    )
    page.set_viewport_size({"width": 768, "height": 1024})
    expect(page.get_by_role("tab", name="左右分屏", exact=True)).to_have_attribute("aria-selected", "true")
    assert page.evaluate(
        "() => { const reader = document.querySelector('.reader'); return reader.scrollWidth <= reader.clientWidth + 2; }"
    )
    page.set_viewport_size({"width": 1440, "height": 900})
    expect(page.get_by_role("tab", name="左右分屏", exact=True)).to_have_attribute("aria-selected", "true")
    expect(page.locator(".pdfColumn")).to_be_visible()
    expect(page.locator(".chatColumn")).to_be_visible()
    expect(page.locator("aside.library")).to_be_visible()
    context.close()


def smoke(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_default_timeout(15000)

    # Hold the cookie-setting response on a fresh session. Page requests must wait.
    sessions = []
    early_reads = []
    context.route(f"{backend}/api/session", lambda route: sessions.append(route))

    def watch_request(request):
        if request.url.startswith(f"{backend}/api/") and not request.url.endswith(("/session", "/health")):
            early_reads.append(request.url)

    page.on("request", watch_request)
    page.goto(f"{frontend}/synthesis")
    expect(page.get_by_text("正在读取论文与已选列表…")).to_be_visible()
    expect(page.get_by_text("两篇全文，是证据对照的起点。")).to_have_count(0)
    assert len(sessions) == 1 and not early_reads, (len(sessions), early_reads)
    page.remove_listener("request", watch_request)
    sessions[0].continue_()
    context.unroute(f"{backend}/api/session")
    expect(page.locator(".synthesisResult")).to_be_visible()

    papers = context.request.get(f"{backend}/api/papers").json()
    assert len(papers) >= 2
    page.locator(".researchNav").evaluate("(node) => node.dataset.smoke = 'persistent'")
    page.locator(".comparePaper").first.click()
    source = page.get_by_role("link", name="打开论文核对")
    source_url = source.get_attribute("href")
    source_id = parse_qs(urlsplit(source_url).query)["paper"][0]
    source_paper = next(paper for paper in papers if paper["id"] == source_id)
    other = next(paper for paper in papers if paper["id"] != source_id)

    # Hold the first paper until the second has rendered to exercise stale requests.
    delayed = []
    context.route(f"{backend}/api/papers/{source_id}", lambda route: delayed.append(route))
    with page.expect_request(f"{backend}/api/papers/{source_id}"):
        source.click()
    expect(page.get_by_text("正在打开论文…", exact=True)).to_be_visible()
    page.locator(".paperItem").filter(has_text=other["title"]).click()
    expect(page.get_by_role("heading", name=other["title"], exact=True)).to_be_visible()
    delayed[0].fulfill(json=context.request.get(f"{backend}/api/papers/{source_id}").json())
    context.unroute(f"{backend}/api/papers/{source_id}")
    expect(page.get_by_role("heading", name=other["title"], exact=True)).to_be_visible()
    expect(page.locator(".researchNav")).to_have_attribute("data-smoke", "persistent")

    page.go_back()
    expect(page.get_by_role("heading", name=source_paper["title"], exact=True)).to_be_visible()
    page.locator(".pdfCanvas canvas").wait_for()
    draft = page.get_by_role("textbox", name="提出你的科研问题")
    draft.fill("Keep this draft with the current paper")
    toolbar = page.locator(".pageTools")
    nav = toolbar.get_by_role("button", name="下一页", exact=True)
    if not nav.is_enabled():
        nav = toolbar.get_by_role("button", name="上一页", exact=True)
    nav.click()
    current_page = parse_qs(urlsplit(page.url).query)["page"][0]
    page.go_forward()
    expect(page.get_by_role("heading", name=other["title"], exact=True)).to_be_visible()
    expect(draft).to_have_value("")
    page.go_back()
    expect(toolbar).to_contain_text(re.compile(rf"{current_page} / [0-9]+"))
    expect(draft).to_have_value("Keep this draft with the current paper")
    page.reload()
    expect(draft).to_have_value("Keep this draft with the current paper")

    chat_url = f"{backend}/api/papers/{source_id}/chat"
    context.route(chat_url, lambda route: route.fulfill(status=503, json={"detail": "精读服务暂不可用"}), times=1)
    page.get_by_role("button", name="发送").click()
    expect(page.get_by_role("alert").filter(has_text="精读服务暂不可用")).to_be_visible()
    expect(draft).to_have_value("Keep this draft with the current paper")
    context.route(chat_url, lambda route: route.fulfill(content_type="text/event-stream",
                  body='data: {"type":"done"}\n\n'), times=1)
    page.get_by_role("button", name="发送").click()
    expect(draft).to_have_value("")
    page.reload()
    expect(draft).to_have_value("")
    page.go_back()
    expect(page.locator(".comparePaper").first).to_be_visible()

    page.get_by_role("tab", name="研究空白").click()
    use_question = page.get_by_role("button", name="用这个问题设计研究")
    question = page.locator(".gapStep").filter(has_text="潜在研究问题").locator(".gapLead").inner_text()
    patches = []

    def hold_handoff(route):
        if route.request.method == "PATCH":
            patches.append(route)
        else:
            route.continue_()

    workspace_url = f"{backend}/api/workspace"
    context.route(workspace_url, hold_handoff)
    with page.expect_request(lambda request: request.method == "PATCH" and request.url == workspace_url):
        use_question.click()
    expect(page.get_by_role("button", name="正在带入研究问题…")).to_be_disabled()
    patches[0].continue_()
    context.unroute(workspace_url)
    idea = page.get_by_label("我的研究想法")
    constraints = page.get_by_label("约束条件（可选）")
    expect(idea).to_have_value(question)
    idea.fill("")  # An intentionally blank draft must also survive a reload.
    constraints.fill("Draft constraints for the current evidence")
    page.locator(".researchNav nav").get_by_role("link", name="深度精读").click()
    expect(page.locator(".reader")).to_be_visible()
    page.locator(".researchNav nav").get_by_role("link", name="科研设计").click()
    expect(constraints).to_have_value("Draft constraints for the current evidence")
    page.reload()
    expect(idea).to_have_value("")
    expect(constraints).to_have_value("Draft constraints for the current evidence")
    alternate = "Independent design idea"
    page.goto(f"{frontend}/design?{urlencode({'idea': alternate})}")
    expect(idea).to_have_value(alternate)
    expect(constraints).to_have_value("")
    constraints.fill("Independent constraints")
    page.go_back()
    expect(idea).to_have_value("")
    expect(constraints).to_have_value("Draft constraints for the current evidence")
    page.get_by_role("button", name="还原已保存内容").click()
    expect(idea).to_have_value(question)
    source_link = page.get_by_role("link", name="返回研究空白查看依据")
    workspace = context.request.get(workspace_url).json()
    assert workspace["gap_context"]["synthesis_id"] == workspace["synthesis_id"]
    expect(source_link).to_have_attribute("href", f"/synthesis?view=gaps&artifact={workspace['synthesis_id']}")
    source_link.click()
    expect(page.get_by_role("tab", name="研究空白")).to_have_attribute("aria-selected", "true")

    # Exercise the homepage search without a dependency on OpenAlex.
    page.locator(".navBrand").click()
    term = "MedRead navigation smoke"

    def search_fixture(route):
        query = parse_qs(urlsplit(route.request.url).query)
        number = int(query["page"][0])
        item = papers[number - 1]
        work = {"openalex_id": f"W{number}", "title": item["title"],
                "authors": [], "year": 2020, "journal": "", "doi": "", "abstract": "",
                "citation_count": 0, "oa_pdf_url": None}
        route.fulfill(json={"items": [work], "count": 2, "page": number, "mode": query["mode"][0]})

    context.route(re.compile(rf"^{re.escape(backend)}/api/research/discover[?]"), search_fixture)
    page.get_by_role("search").get_by_role("textbox").fill(term)
    page.get_by_role("search").get_by_role("button", name="开始检索").click()
    expect(page.get_by_role("textbox", name="论文检索")).to_have_value(term)
    expect(page.locator(".workCard")).to_have_count(1)
    page.get_by_role("button", name="加载更多论文").click()
    expect(page.locator(".workCard")).to_have_count(2)
    page.locator(".researchNav").get_by_role("link", name="深度精读").click()
    expect(page.locator(".reader")).to_be_visible()
    page.go_back()
    expect(page.locator(".workCard")).to_have_count(2)

    # Model a slow attachment after discovery. The reader should open before parsing finishes.
    detail_url = f"{backend}/api/papers/{source_id}"
    source_detail = context.request.get(detail_url).json()
    import_url = f"{backend}/api/research/import"
    attach_url = f"{detail_url}/attach"
    status_url = f"{detail_url}/status"
    context.route(import_url, lambda route: route.fulfill(json={**source_detail, "status": "metadata_only"}), times=1)
    context.route(attach_url, lambda route: route.fulfill(json={"id": source_id, "status": "uploaded"}), times=1)
    context.route(detail_url, lambda route: route.fulfill(json={**source_detail, "status": "uploaded"}), times=1)
    statuses = []
    context.route(status_url, lambda route: statuses.append(route))
    with page.expect_request(status_url):
        page.locator(".workCard").first.locator("input[type=file]").set_input_files(
            {"name": "attachment.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4"}
        )
    expect(page).to_have_url(re.compile(rf"/read[?]paper={source_id}$"))
    expect(page.get_by_text("PDF 正在解析。", exact=False)).to_be_visible()
    context.route(detail_url, lambda route: route.fulfill(status=503, json={}), times=1)
    statuses[0].fulfill(json={"status": "parsed"})
    context.unroute(status_url)
    expect(page.get_by_text("暂时无法读取论文状态，正在重试…", exact=True)).to_be_visible()
    expect(page.locator(".pdfCanvas canvas")).to_be_visible(timeout=12000)

    # Use a real PDF from the isolated demo session to verify the deferred upload.
    expect(page.locator(".library .paperItem").first).to_be_visible()
    pdf = context.request.get(f"{backend}/api/papers/{source_id}/file")
    assert pdf.ok
    with page.expect_response(lambda response: response.url.endswith("/api/papers?deferred=true")) as uploaded:
        page.locator(".libraryHeading input").set_input_files(
            {"name": "navigation-smoke.pdf", "mimeType": "application/pdf", "buffer": pdf.body()}
        )
    paper_id = uploaded.value.json()["id"]
    expect(page).to_have_url(re.compile(rf"/read[?]paper={paper_id}$"))
    expect(page.locator(".pdfCanvas canvas")).to_be_visible(timeout=30000)
    page.get_by_role("button", name="加入待综合").click()
    page.get_by_role("link", name="已选入综合 · 查看").click()
    workspace = context.request.get(workspace_url).json()
    selected_ids = workspace["selected_paper_ids"]
    assert paper_id in selected_ids
    if workspace["synthesis_id"]:
        page.get_by_role("button", name="更换对比论文").click()
    expect(page.locator(".selectionList input:checked")).to_have_count(len(selected_ids))

    page.set_viewport_size({"width": 390, "height": 844})
    for label in ["科研发现", "深度精读", "文献综合", "科研设计"]:
        page.locator(".researchNav").get_by_role("link", name=label).click()
        expect(page.locator("main h1")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2"), label
    assert not errors, errors
    context.close()

    context = browser.new_context()
    page = context.new_page()
    page.set_default_timeout(12000)
    session_url = f"{backend}/api/session"
    papers_url = f"{backend}/api/papers"
    context.route(session_url, lambda route: route.fulfill(status=503, json={}), times=1)
    context.route(papers_url, lambda route: route.fulfill(status=503, json={}), times=1)
    page.goto(f"{frontend}/read")
    page.get_by_role("button", name="重试读取工作区").click()
    expect(page.locator(".researchNav .workspaceSummary")).to_contain_text("篇待综合")
    retry_library = page.get_by_role("button", name="重试读取论文库")
    retry_library.click()
    expect(page.locator(".library .paperItem").first).to_be_visible()
    context.route(f"{backend}/api/health", lambda route: route.fulfill(status=503, json={}), times=1)
    page.goto(frontend)
    expect(page.get_by_text("暂时无法确认服务状态")).to_be_visible()
    page.get_by_role("button", name="重试检查").click()
    expect(page.get_by_text("服务运行正常")).to_be_visible()
    context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend", default="http://127.0.0.1:3320")
    parser.add_argument("--backend", default="http://127.0.0.1:8320")
    parser.add_argument("--chrome", action="store_true", help="Use installed Google Chrome")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome" if args.chrome else None)
        try:
            smoke(browser, args.frontend, args.backend)
            background_jobs(browser, args.frontend, args.backend)
            manual_design_draft(browser, args.frontend, args.backend)
            compact_reading(browser, args.frontend, args.backend)
            shared_selection(browser, args.frontend, args.backend)
            reader_reparse(browser, args.frontend, args.backend)
        finally:
            browser.close()
    print("MedRead navigation smoke passed")
