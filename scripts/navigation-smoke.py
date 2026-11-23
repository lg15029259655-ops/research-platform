"""Browser regression for an isolated MedRead preview with the demo seed enabled."""

import argparse
import json
import re
from urllib.parse import parse_qs, urlencode, urlsplit

from playwright.sync_api import expect, sync_playwright


def reopen_saved_job_result(browser, frontend, backend):
    for scope, kind in [("synthesis", "compare"), ("design", "design")]:
        context = browser.new_context(viewport={"width": 390, "height": 844})
        assert context.request.get(f"{backend}/api/session").ok
        workspace_url = f"{backend}/api/workspace"
        workspace = context.request.get(workspace_url).json()
        if scope == "synthesis":
            url = f"{backend}/api/research/comparisons/{workspace['synthesis_id']}?view=matrix"
            result = context.request.get(url).json()
            result["payload"]["consensus"] = ["Recovered saved comparison"]
            context.route(url, lambda route: route.fulfill(json=result))
        else:
            version_url = f"{backend}/api/research/design/versions?artifact_id={workspace['design_version_id']}"
            version = context.request.get(version_url).json()[0]
            result = {"id": version["artifact_id"], "payload": version["payload"], "version": version}

        offline = True
        reads = []
        submissions = []
        ticket_key = f"medread-job-{scope}"
        job_url = f"{backend}/api/jobs/completed-fixture"

        def workspace_fixture(route):
            if offline:
                route.fulfill(status=503, json={})
            else:
                route.fallback()

        def job_fixture(route):
            if route.request.method == "POST":
                submissions.append(route.request.url)
                route.fulfill(status=500, json={})
                return
            reads.append(route.request.url)
            snapshot = {"id": "completed-fixture", "kind": kind, "status": "done", "result": result}
            if route.request.url.endswith("/events"):
                route.fulfill(content_type="text/event-stream",
                              body="event: snapshot\ndata: " + json.dumps(snapshot) + "\n\n")
            else:
                route.fulfill(json=snapshot)

        context.route(workspace_url, workspace_fixture)
        context.route(re.compile(rf"^{re.escape(backend)}/api/jobs(?:/|$)"), job_fixture)
        page = context.new_page()
        page.goto(frontend)
        page.evaluate("""([key, kind]) => sessionStorage.setItem(
          key, JSON.stringify({id: "completed-fixture", kind, startedAt: Date.now()})
        )""", [ticket_key, kind])
        path = f"{frontend}/{scope}"
        page.goto(path)
        retry = page.get_by_role("button", name="重试打开结果")
        expect(retry).to_be_visible()
        assert page.evaluate("(key) => !!sessionStorage.getItem(key)", ticket_key)
        page.reload()
        expect(retry).to_be_visible()
        offline = False
        job_reads_before_retry = len(reads)
        retry.click()
        expect(retry).to_have_count(0)
        if scope == "synthesis":
            expect(page.locator(".compareTakeaways")).to_contain_text("Recovered saved comparison")
        else:
            expect(page.locator(".designGrid")).to_be_visible()
        page.wait_for_function("(key) => sessionStorage.getItem(key) === null", arg=ticket_key)
        assert len(reads) >= 2 and all(url.startswith(job_url) for url in reads)
        assert len(reads) == job_reads_before_retry
        assert not submissions
        context.close()


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

    def comparison_view_fixture(route):
        if status["comparison"] == "done":
            route.fulfill(json=artifact)
        else:
            route.fallback()

    matrix_url = f"{backend}/api/research/comparisons/{artifact['id']}?view=matrix"
    context.route(matrix_url, comparison_view_fixture)
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

    ticket_key = "medread-job-synthesis"
    assert json.loads(page.evaluate("(key) => sessionStorage.getItem(key)", ticket_key))["id"] == "comparison"
    status["comparison"] = "done"
    with page.expect_request(f"{backend}/api/jobs/comparison/events"):
        page.reload()
    expect(page.locator(".compareTakeaways p").filter(has_text="已恢复后台综合结果")).to_be_visible()
    page.wait_for_function("(key) => sessionStorage.getItem(key) === null", arg=ticket_key)
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


def reload_before_job_confirmation(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.goto(f"{frontend}/synthesis")
    page.get_by_role("button", name="更换对比论文").click()
    page.locator(".selectionList input").last.uncheck()
    expect(page.get_by_text("正在保存论文选择…")).to_have_count(0)
    submissions = []
    held = []
    lookups = []
    job_reads = []
    page.on("request", lambda request: job_reads.append(request.url) if "/api/jobs/" in request.url else None)

    def hold_confirmation(route):
        body = route.request.post_data_json
        # Exercise the real queue without asking a model to generate a result.
        response = route.fetch(post_data={**body, "params": {"paper_ids": []}})
        assert response.status == 202, response.text()
        submissions.append((body["request_id"], response.json()["id"]))
        held.append(route)

    context.route(f"{backend}/api/jobs", hold_confirmation)
    page.get_by_role("button", name="按当前选择重新综合").click()
    expect(page.get_by_text("正在提交任务")).to_be_visible()
    pending = page.evaluate("JSON.parse(sessionStorage.getItem('medread-job-synthesis'))")
    assert "requestId" in pending and "id" not in pending
    receipt_url = f"{backend}/api/jobs/submissions/{pending['requestId']}"

    def temporarily_offline(route):
        lookups.append(route.request.url)
        route.abort("internetdisconnected")

    context.route(receipt_url, temporarily_offline, times=1)
    with page.expect_request(receipt_url):
        page.reload()
    expect(page.get_by_role("alert").filter(has_text="请选择至少两篇论文")).to_be_visible()
    assert len(submissions) == 1 and submissions[0][0] == pending["requestId"]
    assert lookups == [receipt_url]
    recovered = context.request.get(receipt_url).json()
    assert recovered["id"] == submissions[0][1] and recovered["status"] == "failed"
    assert job_reads == [receipt_url, receipt_url]
    held[0].abort()
    context.close()


def reload_before_upload_confirmation(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    assert context.request.get(f"{backend}/api/session").ok
    workspace = context.request.get(f"{backend}/api/workspace").json()
    library_url = f"{backend}/api/papers"
    initial_ids = {paper["id"] for paper in context.request.get(library_url).json()}
    original = context.request.get(f"{library_url}/{workspace['core_paper_id']}/file")
    assert original.ok
    held = []
    submit_url = re.compile(rf"^{re.escape(library_url)}\?deferred=true&request_id=")

    def hold_upload(route):
        accepted = route.fetch()
        assert accepted.ok, accepted.text()
        request_id = parse_qs(urlsplit(route.request.url).query)["request_id"][0]
        held.append((route, request_id, accepted.json()["id"]))

    context.route(submit_url, hold_upload)
    page.goto(f"{frontend}/read")
    page.get_by_role("button", name="展开论文库").click()
    with page.expect_request(submit_url):
        page.locator(".libraryHeading input").set_input_files(
            {"name": "receipt-check.pdf", "mimeType": "application/pdf", "buffer": original.body()}
        )
    expect(page.get_by_text("正在上传 PDF…", exact=True)).to_be_visible()
    pending = page.evaluate("JSON.parse(sessionStorage.getItem('medread-draft:read-pending-upload'))")
    receipt_url = f"{library_url}/uploads/{pending['requestId']}"
    context.route(receipt_url, lambda route: route.abort("internetdisconnected"), times=1)
    with page.expect_request(receipt_url):
        page.reload()
    expect(page).to_have_url(re.compile(rf"/read\?paper={held[0][2]}$"))
    expect(page.locator(".pdfCanvas canvas")).to_be_visible(timeout=30000)
    assert len(held) == 1 and held[0][1] == pending["requestId"]
    assert {paper["id"] for paper in context.request.get(library_url).json()} == initial_ids | {held[0][2]}
    assert page.evaluate("sessionStorage.getItem('medread-draft:read-pending-upload')") is None
    held[0][0].abort()
    context.close()


def stage_experiment_draft(browser, frontend, backend, *, viewport=None):
    context = browser.new_context(viewport=viewport or {"width": 390, "height": 844})
    assert context.request.get(f"{backend}/api/session").ok
    workspace_url = f"{backend}/api/workspace"
    base_id = context.request.get(workspace_url).json()["design_version_id"]
    history_url = f"{backend}/api/research/design/history"
    initial_count = len(context.request.get(history_url).json()["items"])
    page = context.new_page()
    page.goto(f"{frontend}/design?view=canvas")
    version_label = page.locator(".versionBar strong").inner_text()
    stages = page.locator(".er-stage-main")
    page.emulate_media(reduced_motion="reduce")
    preview = page.locator(".er-preview-item").first
    group_id = preview.evaluate("(button) => button.closest('.er-stage-group').id")
    preview_stage = page.locator(f"[id={json.dumps(group_id)}] .er-stage-main")
    preview.focus()
    preview.press("Enter")
    expect(preview_stage).to_be_focused()
    expect(preview_stage).to_have_attribute("aria-expanded", "true")
    preview_stage.press("Enter")
    expect(preview_stage).to_have_attribute("aria-expanded", "false")

    stages.first.click()
    details = page.locator(".er-detail")
    edit = details.get_by_role("button", name="编辑阶段", exact=True)
    instruction = page.get_by_role("dialog").get_by_label("希望怎样修改这个节点？")
    edit.focus()
    edit.press("Enter")
    instruction.fill("Review only this stage")
    original_size = page.viewport_size
    node_drawer = page.get_by_role("dialog")
    page.set_viewport_size({"width": 1440, "height": 900})
    expect(node_drawer).to_be_visible()
    assert node_drawer.evaluate("node => node.matches(':modal')")
    background_link = page.locator('.researchNav nav a[href="/synthesis"]')
    nav_box, modal_box = background_link.bounding_box(), node_drawer.bounding_box()
    assert nav_box["x"] + nav_box["width"] < modal_box["x"]
    page.mouse.click(nav_box["x"] + nav_box["width"] / 2, nav_box["y"] + nav_box["height"] / 2)
    expect(page).to_have_url(f"{frontend}/design?view=canvas")
    expect(node_drawer).to_be_visible()
    instruction.focus()
    background_link.evaluate("link => link.focus()")
    expect(instruction).to_be_focused()
    page.set_viewport_size({"width": 320, "height": 256})
    node_drawer.evaluate("node => { node.scrollTop = node.scrollHeight; }")
    assert node_drawer.evaluate("node => node.scrollTop > 100")
    expect(node_drawer.get_by_role("button", name="关闭详情", exact=True)).to_be_in_viewport(ratio=1)
    instruction.press("Escape")
    expect(edit).to_be_focused()
    page.set_viewport_size(original_size)
    stages.nth(1).click()
    edit.click()
    expect(instruction).to_have_value("")
    instruction.press("Escape")
    stages.first.click()
    edit.click()
    expect(instruction).to_have_value("Review only this stage")
    instruction.press("Escape")
    expect(edit).to_be_focused()

    add = details.get_by_role("button", name="添加实验")
    add.focus()
    add.press("Enter")
    form = page.locator(".er-add")
    name = form.get_by_label("实验名称", exact=True)
    purpose = form.get_by_label("目的", exact=True)
    expect(name).to_be_focused()
    name.fill("Check saved input")
    purpose.fill("Confirm the draft survives a source check")
    stages.nth(1).click()
    details.get_by_role("button", name="添加实验").click()
    expect(name).to_have_value("")
    stages.first.click()
    expect(name).to_have_value("Check saved input")
    page.locator(".researchNav nav").get_by_role("link", name="文献综合").click()
    expect(page).to_have_url(f"{frontend}/synthesis")
    page.go_back()
    expect(purpose).to_have_value("Confirm the draft survives a source check")

    save = form.get_by_role("button", name="保存为新版本")
    save_url = f"{backend}/api/research/design/manual"
    context.route(save_url, lambda route: route.fulfill(status=503, json={"detail": "实验步骤暂时无法保存"}), times=1)
    with page.expect_request(save_url) as failed:
        save.click()
    expect(form.get_by_role("alert")).to_contain_text("实验步骤暂时无法保存")
    request_id = failed.value.post_data_json["request_id"]
    page.reload()
    expect(name).to_have_value("Check saved input")
    expect(purpose).to_have_value("Confirm the draft survives a source check")

    def drop_save_response(route):
        assert route.request.post_data_json["request_id"] == request_id
        assert route.fetch().ok
        context.route(workspace_url, lambda check: check.fulfill(status=503, json={}), times=1)
        route.abort("connectionreset")

    context.route(save_url, drop_save_response, times=1)
    receipt_url = f"{save_url}/receipts/{request_id}"
    with page.expect_response(lambda response: response.url == receipt_url and response.ok):
        save.focus()
        save.press("Enter")
    saved_notice = page.get_by_role("status").filter(has_text="暂时无法确认工作区当前版本")
    expect(saved_notice).to_be_visible()
    receipt = context.request.get(receipt_url).json()
    saved_stage_id = receipt["payload"]["nodes"][0]["id"]
    deep_link = f"/design?{urlencode({'version': receipt['id'], 'stage': saved_stage_id})}"
    expect(page.get_by_role("link", name="查看已保存阶段", exact=True)).to_have_attribute("href", deep_link)
    retry = page.get_by_role("button", name="核对当前版本", exact=True)
    retry.focus()
    retry.press("Enter")
    expect(page.locator(".versionBar button.active")).to_contain_text("手动编辑")
    expect(saved_notice).to_have_count(0)
    expect(stages.first).to_have_attribute("aria-expanded", "true")
    expect(stages.first).to_be_focused()
    expect(details.get_by_role("heading", name="Check saved input")).to_be_visible()
    assert context.request.get(workspace_url).json()["design_version_id"] == receipt["id"]
    assert len(context.request.get(history_url).json()["items"]) == initial_count + 1
    assert sum(step["name"] == "Check saved input" for node in receipt["payload"]["nodes"]
               for step in node.get("steps", [])) == 1
    historical = context.new_page()
    historical.emulate_media(reduced_motion="reduce")
    historical.goto(frontend + deep_link)
    stage_group = historical.locator(f"[id={json.dumps(f'er-node-{saved_stage_id}')}]")
    stage_heading = stage_group.locator(".er-stage-main")
    expect(stage_heading).to_be_focused()
    expect(stage_heading).to_have_attribute("aria-expanded", "true")
    expect(stage_group.get_by_role("heading", name="Check saved input")).to_be_visible()
    expect(stage_group.get_by_role("button", name="编辑阶段", exact=True)).to_have_count(0)
    assert historical.evaluate("key => sessionStorage.getItem(key)", f"medread-draft:design-stage:{receipt['id']}") is None
    stage_heading.press("Enter")
    expect(stage_heading).to_have_attribute("aria-expanded", "false")
    historical.goto(f"{frontend}/design?{urlencode({'version': receipt['id'], 'stage': 'missing-stage'})}")
    expect(historical.get_by_role("status").filter(has_text="没有链接指向的阶段")).to_be_visible()
    expect(historical.locator(".er-stage-main[aria-expanded=true]")).to_have_count(0)
    historical.close()
    page.get_by_role("button", name="撤回上一版本").click()
    expect(page.locator(".versionBar strong")).to_have_text(version_label)
    assert context.request.get(workspace_url).json()["design_version_id"] == base_id
    expect(form).to_have_count(0)
    edit.click()
    instruction.fill("Retain the research question while updating this stage")
    job_url = f"{backend}/api/jobs"
    context.route(job_url, lambda route: route.fulfill(status=422, json={"detail": "阶段优化测试响应"}), times=1)
    with page.expect_request(job_url) as stage_job:
        page.get_by_role("button", name="AI 优化此节点").click()
    assert stage_job.value.post_data_json["params"]["action"] == "node"
    expect(node_drawer).to_have_count(0)
    context.close()


def manual_design_draft(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    summary_url = re.compile(rf"^{re.escape(backend)}/api/research/design/versions\?summary=true")
    held = []
    context.route(summary_url, lambda route: held.append(route), times=1)
    page.goto(f"{frontend}/design")
    editor = page.locator(".design-step-editor")
    editor.get_by_role("button", name="手动添加或删除实验步骤").click()
    assert held, "The current canvas should load while its version list is pending"
    held[0].fulfill(status=503, json={})
    page.get_by_role("button", name="重试版本列表").click()
    expect(page.get_by_role("button", name="重试版本列表")).to_have_count(0)
    expect(editor).to_be_visible()
    version_label = page.locator(".versionBar strong").inner_text()
    step = editor.get_by_label("新步骤名称")
    notes = editor.get_by_label("目的或操作说明（可选）")
    step.fill("Review the baseline evidence")
    notes.fill("Keep this step in the local draft before creating a new version.")
    constraints = page.get_by_label("约束条件（可选）")
    constraints.fill("Keep the study within the current budget")
    save = editor.get_by_role("button", name="保存为新版本")
    expect(save).to_be_disabled()
    workspace_url = f"{backend}/api/workspace"

    def fail_workspace(route):
        route.fulfill(status=503, json={})

    context.route(workspace_url, fail_workspace)
    page.reload()
    expect(constraints).to_be_disabled()
    retry_workspace = page.get_by_label("当前研究工作区").get_by_role("button", name="重试读取工作区")
    expect(retry_workspace).to_be_visible()
    context.unroute(workspace_url, fail_workspace)
    retry_workspace.click()
    expect(constraints).to_have_value("Keep the study within the current budget")
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
    history_url = f"{backend}/api/research/design/history"
    version_count = len(context.request.get(history_url).json()["items"])
    context.route(save_url, lambda route: route.fulfill(status=503, json={"detail": "步骤保存暂不可用"}), times=1)
    with page.expect_request(save_url) as first:
        save.click()
    expect(editor.get_by_role("alert").filter(has_text="步骤保存暂不可用")).to_be_visible()
    expect(editor.get_by_role("textbox", name="步骤名称：Review the baseline evidence", exact=True)).to_be_visible()
    request_id = first.value.post_data_json["request_id"]
    page.reload()
    receipt_url = f"{save_url}/receipts/{request_id}"

    def drop_save_response(route):
        assert route.request.post_data_json["request_id"] == request_id
        assert route.fetch().ok
        route.abort("connectionreset")

    context.route(save_url, drop_save_response, times=1)
    with page.expect_response(lambda response: response.url == receipt_url and response.ok):
        save.click()
    expect(page.locator(".versionBar button.active")).to_contain_text("手动编辑")
    assert len(context.request.get(history_url).json()["items"]) == version_count + 1
    page.reload()
    editor.get_by_role("button", name="手动添加或删除实验步骤").click()
    expect(editor.get_by_role("textbox", name="步骤名称：Review the baseline evidence", exact=True)).to_be_visible()
    expect(save).to_be_disabled()
    restore_url = re.compile(rf"^{re.escape(backend)}/api/research/design/versions/[^/]+/restore$")

    def drop_undo_response(route):
        assert route.fetch().ok
        route.abort("connectionreset")

    context.route(restore_url, drop_undo_response, times=1)
    page.get_by_role("button", name="撤回上一版本").click()
    expect(page.locator(".versionBar strong")).to_have_text(version_label)
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
    assert after["content_revision"] and after["content_revision"] != prior["content_revision"]
    assert after["file_version"] == prior["file_version"]
    assert [item["id"] for item in after["messages"]] == [item["id"] for item in prior["messages"]]
    context.close()


def reader_reparse_recovery(browser, frontend, backend, *, viewport=None):
    with browser.new_context(viewport=viewport) as context:
        assert context.request.get(f"{backend}/api/session").ok
        paper_id = context.request.get(f"{backend}/api/workspace").json()["core_paper_id"]
        detail_url = f"{backend}/api/papers/{paper_id}"
        prior = {**context.request.get(detail_url).json(), "warning": "未可靠识别论文章节"}
        draft = "Retain my research question while rechecking this PDF"
        context.route(detail_url, lambda route: route.fulfill(json=prior))
        submitted = []

        def disconnect(route):
            submitted.append(route.request.method)
            route.abort("connectionreset")

        context.route(detail_url + "/reparse", disconnect)
        page = context.new_page()
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(f"{frontend}/read?paper={paper_id}")
        if viewport:
            page.get_by_role("tab", name="AI 讲解", exact=True).click()
        question = page.get_by_role("textbox", name="提出你的科研问题")
        question.fill(draft)
        expect(page.get_by_role("button", name=re.compile(r"^发送"))).to_be_enabled()
        page.get_by_role("button", name="重新识别当前 PDF").click()
        warning = page.get_by_role("alert").filter(has_text="暂时无法确认 PDF 解析请求是否已受理")
        expect(warning).to_be_visible()
        expect(question).to_have_value(draft)
        assert len(submitted) == 1
        next_detail = {**prior, "warning": None, "content_revision": "recovered-new-revision"}
        context.route(detail_url, lambda route: route.fulfill(json=next_detail), times=1)
        page.get_by_role("button", name="核对解析状态", exact=True).click()
        expect(warning).to_have_count(0)
        expect(page.get_by_role("button", name="重新识别当前 PDF")).to_have_count(0)
        expect(question).to_have_value(draft)
        assert submitted == ["POST"]
        if viewport:
            page.get_by_role("tab", name="原文 PDF", exact=True).click()
        expect(page.locator(".pdfCanvas canvas")).to_be_visible()


def cross_tab_paper_library(browser, frontend, backend, *, viewport=None):
    with browser.new_context(viewport=viewport) as context:
        assert context.request.get(f"{backend}/api/session").ok
        workspace_url = f"{backend}/api/workspace"
        workspace = context.request.get(workspace_url).json()
        paper_id = workspace["core_paper_id"]
        library_url = f"{backend}/api/papers?view=summary"
        papers = context.request.get(library_url).json()
        target = next(item for item in papers if item["id"] == paper_id)
        target["openalex_id"] = "W209"
        detail_url = f"{backend}/api/papers/{paper_id}"
        detail = {**context.request.get(detail_url).json(), "warning": "未可靠识别论文章节"}
        work = {"openalex_id": "W209", "title": target["title"], "authors": [], "year": 2021,
                "journal": "", "doi": "", "abstract": "", "citation_count": 0, "oa_pdf_url": None}

        def paper_request(route):
            if route.request.method == "DELETE":
                papers.remove(target)
                workspace["selected_paper_ids"].remove(paper_id)
                workspace.update(core_paper_id=None, synthesis_id=None)
                route.fulfill(json={"deleted": True})
            elif target in papers:
                route.fulfill(json=detail)
            else:
                route.fulfill(status=404, json={"detail": "论文不存在"})

        def reparse(route):
            target["status"] = detail["status"] = "reading"
            route.fulfill(json={"id": paper_id, "status": "uploaded"})

        context.route(library_url, lambda route: route.fulfill(json=papers))
        context.route(workspace_url, lambda route: route.fulfill(json=workspace))
        context.route(detail_url, paper_request)
        context.route(detail_url + "/reparse", reparse)
        context.route(detail_url + "/status", lambda route: route.fulfill(json={"status": detail["status"]}))
        context.route(re.compile(rf"^{re.escape(backend)}/api/research/discover[?]"),
                      lambda route: route.fulfill(json={"items": [work], "count": 1, "page": 1, "mode": "semantic"}))
        discover = context.new_page()
        discover.goto(f"{frontend}/discover?q=library-sync")
        expect(discover.get_by_role("link", name="打开全文精读")).to_be_visible()
        synthesis = context.new_page()
        synthesis.goto(f"{frontend}/synthesis")
        synthesis.get_by_role("button", name="更换对比论文", exact=True).click()
        checkbox = synthesis.locator(".selectionList label").filter(has_text=target["title"]).get_by_role("checkbox")
        expect(checkbox).to_be_checked()
        peer_reader = context.new_page()
        peer_reader.goto(f"{frontend}/read?paper={paper_id}")
        expect(peer_reader.get_by_role("heading", name=target["title"], exact=True)).to_be_visible()

        reader = context.new_page()
        reader.on("dialog", lambda dialog: dialog.accept())
        reader.goto(f"{frontend}/read?paper={paper_id}")
        reader.get_by_role("button", name="重新识别当前 PDF", exact=True).click()
        expect(discover.get_by_role("link", name="查看解析进度")).to_be_visible()
        expect(synthesis.get_by_text(f"{target['title']} · PDF 正在解析", exact=True)).to_be_visible()
        expect(peer_reader.get_by_text("PDF 正在解析。", exact=False)).to_be_visible()

        if viewport:
            reader.get_by_role("button", name="展开论文库", exact=True).click()
        reader.get_by_role("button", name=f"删除 {target['title']}", exact=True).click()
        expect(discover.locator(".workCard").get_by_text("尚无全文", exact=True)).to_be_visible()
        expect(discover.get_by_role("link", name="查看解析进度")).to_have_count(0)
        expect(peer_reader.get_by_text("这篇论文已从论文库移除。", exact=True)).to_be_visible()
        expect(synthesis.get_by_text(f"{target['title']} · PDF 正在解析", exact=True)).to_have_count(0)
        expect(synthesis.get_by_role("heading", name=re.compile("^选择论文"))).to_contain_text(
            f"{len(workspace['selected_paper_ids'])} / 5"
        )


def pending_pdf_selection(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    assert context.request.get(f"{backend}/api/session").ok
    workspace_url = f"{backend}/api/workspace"
    workspace = context.request.get(workspace_url).json()
    blocked, parsing, *_ = workspace["selected_paper_ids"]
    library_url = f"{backend}/api/papers?view=summary"
    papers = context.request.get(library_url).json()
    blocked_paper = next(item for item in papers if item["id"] == blocked)
    parsing_paper = next(item for item in papers if item["id"] == parsing)
    blocked_paper.update(source_matches=False, openalex_id="W201")
    parsing_paper.update(status="reading", openalex_id="W202")
    context.route(library_url, lambda route: route.fulfill(json=papers))
    page = context.new_page()
    page.goto(f"{frontend}/synthesis")
    page.get_by_role("button", name="更换对比论文").click()
    expect(page.get_by_text(re.compile("PDF 与已保存的阅读内容不一致"))).to_be_visible()
    expect(page.get_by_text(re.compile("PDF 正在解析"))).to_be_visible()
    run = page.get_by_role("button", name=re.compile("生成对比|按当前选择重新综合"))
    expect(run).to_be_disabled()
    expect(page.locator(f'a[href="/read?paper={blocked}"]')).to_have_text("打开论文")
    parsing_paper["status"] = "parsed"
    expect(page.get_by_text(re.compile("PDF 正在解析"))).to_have_count(0, timeout=9000)
    expect(run).to_be_disabled()
    page.get_by_role("button", name=f"移出待综合 {blocked_paper['title']}", exact=True).click()
    expect(run).to_be_enabled()
    assert context.request.get(workspace_url).json()["selected_paper_ids"] == [
        item for item in workspace["selected_paper_ids"] if item != blocked
    ]

    work = {"openalex_id": "W201", "title": blocked_paper["title"], "authors": [], "year": 2020,
            "journal": "", "doi": "", "abstract": "", "citation_count": 0, "oa_pdf_url": None}
    context.route(re.compile(rf"^{re.escape(backend)}/api/research/discover[?]"),
                  lambda route: route.fulfill(json={"items": [work], "count": 1, "page": 1, "mode": "semantic"}))
    page.goto(f"{frontend}/discover?q=pdf-repair-fixture")
    repair = page.get_by_role("link", name="打开论文处理")
    expect(repair).to_have_attribute("href", f"/read?paper={blocked}")
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


def pdf_search_recovery(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    assert context.request.get(f"{backend}/api/session").ok
    paper_id = context.request.get(f"{backend}/api/workspace").json()["core_paper_id"]
    detail = f"{backend}/api/papers/{paper_id}"
    file_request = re.compile(rf"^{re.escape(detail)}/file(?:\?|$)")
    context.route(file_request, lambda route: route.fulfill(status=503, body="Temporarily unavailable"), times=1)
    page.goto(f"{frontend}/read?paper={paper_id}")
    page.get_by_role("button", name="重试打开 PDF").click()
    expect(page.locator(".pdfCanvas canvas")).to_be_visible()
    search_box = page.get_by_role("textbox", name="在 PDF 内搜索文字")
    page_number = page.locator(".pageTools span").first
    position = page_number.inner_text()
    delayed = []
    old_search = f"{detail}/search?q=previous"
    context.route(old_search, lambda route: delayed.append(route), times=1)
    search_box.fill("previous")
    with page.expect_request(old_search):
        search_box.press("Enter")
    expect(page.get_by_text("正在搜索 PDF…", exact=True)).to_be_visible()
    search_box.fill("no-match-recovery-probe")
    delayed[0].fulfill(json=[{"page": 2, "snippet": "Old search result"}])
    expect(page.locator(".searchHits")).to_have_count(0)
    expect(page_number).to_have_text(position)
    next_search = f"{detail}/search?q=no-match-recovery-probe"
    context.route(next_search, lambda route: route.abort("internetdisconnected"), times=1)
    search_box.press("Enter")
    expect(page.get_by_role("alert").filter(has_text="连接中断")).to_be_visible()
    page.get_by_role("button", name="重试搜索", exact=True).click()
    expect(page.get_by_text("没有找到匹配文字。", exact=True)).to_be_visible()
    expect(page_number).to_have_text(position)
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
    current_title = drawer.locator('.paperItem[aria-current="true"] strong').inner_text()
    papers = context.request.get(f"{backend}/api/papers").json()
    other = next(item for item in papers if item["title"] != current_title)
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
    page.set_viewport_size({"width": 320, "height": 256})
    library_toggle.click()
    close = drawer.get_by_role("button", name="关闭论文库", exact=True)
    expect(close).to_be_focused()
    search.fill("")
    last_paper = drawer.locator(".paperItem").last
    last_paper.scroll_into_view_if_needed()
    expect(last_paper).to_be_in_viewport(ratio=0.9)
    expect(close).to_be_in_viewport(ratio=1)
    assert drawer.locator(".library").evaluate("(element) => element.scrollTop > 0")
    upload = drawer.get_by_role("button", name="上传 PDF")
    expect(upload).to_be_in_viewport(ratio=1)
    upload_box, close_box = upload.bounding_box(), close.bounding_box()
    assert upload_box["x"] + upload_box["width"] <= close_box["x"]
    assert last_paper.bounding_box()["y"] >= close_box["y"] + close_box["height"]
    page.keyboard.press("Escape")
    expect(drawer).to_have_count(0)
    expect(library_toggle).to_be_focused()

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
    question = page.get_by_role("textbox", name="提出你的科研问题")
    question.fill("Keep typing across viewport changes")
    question.focus()
    page.set_viewport_size({"width": 320, "height": 675})
    expect(pdf_tab).to_be_focused()
    expect(question).to_be_hidden()
    page.keyboard.press("ArrowRight")
    expect(chat_tab).to_be_focused()
    expect(question).to_have_value("Keep typing across viewport changes")
    question.focus()
    page.set_viewport_size({"width": 1440, "height": 900})
    expect(page.get_by_role("tab", name="左右分屏", exact=True)).to_have_attribute("aria-selected", "true")
    expect(question).to_be_focused()
    page.set_viewport_size({"width": 390, "height": 844})
    expect(chat_tab).to_have_attribute("aria-selected", "true")
    expect(question).to_be_focused()

    library_toggle.click()
    expect(drawer.get_by_role("button", name="关闭论文库", exact=True)).to_be_focused()
    page.set_viewport_size({"width": 768, "height": 1024})
    expect(page.locator(".libraryToggle")).to_be_focused()
    expect(page.locator("aside.library")).to_be_visible()
    context.close()


def reader_delete_recovery(browser, frontend, backend, *, viewport=None):
    with browser.new_context(viewport=viewport) as context:
        assert context.request.get(f"{backend}/api/session").ok
        library_url = f"{backend}/api/papers?view=summary"
        papers = [item for item in context.request.get(library_url).json() if item["status"] == "parsed"]
        paper, other = papers[:2]
        path = f"{backend}/api/papers/{paper['id']}"
        attempts = []
        removed = False

        def paper_request(route):
            if route.request.method == "DELETE":
                attempts.append(route)
            elif removed:
                route.fulfill(status=404, json={"detail": "论文不存在"})
            else:
                route.continue_()

        context.route(path, paper_request)
        page = context.new_page()
        page.on("dialog", lambda dialog: dialog.accept())
        page.goto(f"{frontend}/read?paper={paper['id']}")
        if viewport:
            page.get_by_role("tab", name="AI 讲解", exact=True).click()
        draft = page.get_by_role("textbox", name="提出你的科研问题")
        question = "Preserve this draft until deletion is confirmed"
        key = f"medread-draft:read:{paper['id']}"
        draft.fill(question)
        page.wait_for_function("([key, value]) => sessionStorage.getItem(key) === JSON.stringify(value)",
                               arg=[key, question])
        toggle = page.get_by_role("button", name="展开论文库", exact=True)
        if viewport:
            toggle.click()
        library = page.get_by_role("dialog", name="论文库") if viewport else page.locator(".library")
        delete = library.get_by_role("button", name=f"删除 {paper['title']}", exact=True)
        with page.expect_request(lambda request: request.url == path and request.method == "DELETE"):
            delete.click()
        expect(delete).to_be_disabled()
        expect(library.get_by_role("status").filter(has_text="正在确认删除结果")).to_be_visible()
        attempts[0].abort("connectionreset")
        expect(library.get_by_role("alert").filter(has_text="暂时无法确认删除结果")).to_be_visible()
        expect(delete).to_be_enabled()
        assert page.evaluate("key => sessionStorage.getItem(key)", key) == json.dumps(question)
        assert parse_qs(urlsplit(page.url).query)["paper"] == [paper["id"]]

        with page.expect_request(lambda request: request.url == path and request.method == "DELETE"):
            delete.click()
        expect(delete).to_be_disabled()
        if viewport:
            library.locator(".paperItem").filter(has_text=other["title"]).click()
            expect(page.get_by_role("heading", name=other["title"], exact=True)).to_be_visible()
        context.route(library_url, lambda route: route.fulfill(status=503, json={}), times=1)
        removed = True
        attempts[1].abort("connectionreset")
        if viewport:
            toggle.click()
        expect(library.get_by_role("alert").filter(has_text="暂时无法读取论文库")).to_be_visible()
        expect(library.get_by_role("status").filter(has_text=f"已从论文库移除：{paper['title']}")).to_be_visible()
        expect(delete).to_have_count(0)
        assert page.evaluate("key => sessionStorage.getItem(key)", key) is None
        assert parse_qs(urlsplit(page.url).query).get("paper") == ([other["id"]] if viewport else None)
        assert len(attempts) == 2


def reader_chat_idle_recovery(browser, frontend, backend, *, viewport=None):
    with browser.new_context(viewport=viewport) as context:
        page = context.new_page()
        page.clock.install()
        page.add_init_script("""(() => {
            const fetchOriginal = window.fetch.bind(window);
            const probe = window.chatProbe = { turns: [], opened: 0 };
            window.fetch = (url, options) => {
                if (typeof url !== "string" || !url.endsWith("/chat") || options?.method !== "POST") {
                    return fetchOriginal(url, options);
                }
                probe.turns.push(JSON.parse(options.body).turn_id);
                return new Promise((resolve, reject) => {
                    let stream;
                    options.signal.addEventListener("abort", () => {
                        if (stream) stream.error(options.signal.reason);
                        else reject(options.signal.reason);
                    }, { once: true });
                    if (probe.turns.length === 1) return; // No response headers.
                    resolve(new Response(new ReadableStream({
                        start(controller) {
                            stream = controller;
                            const emit = (text) => stream.enqueue(new TextEncoder().encode(text));
                            probe.heartbeat = () => emit(": ping\\n\\n");
                            probe.finish = () => emit('data: {"type":"done"}\\n\\n');
                            emit('data: {"type":"delta","content":"Partial reply before the stall"}\\n\\n');
                            probe.opened += 1;
                        }
                    }), { headers: { "Content-Type": "text/event-stream" } }));
                });
            };
        })()""")
        with page.expect_response(lambda response: response.ok and
                                  response.url.startswith(f"{backend}/api/papers/") and
                                  "/" not in response.url.removeprefix(f"{backend}/api/papers/")) as opened:
            page.goto(f"{frontend}/read")
        detail_url = opened.value.url
        if viewport:
            page.get_by_role("tab", name="AI 讲解", exact=True).click()
        draft = page.get_by_role("textbox", name="提出你的科研问题")
        expect(draft).to_be_visible()
        draft.fill("Keep this question when the connection stalls")
        send = page.get_by_role("button", name=re.compile(r"^发送"))
        send.click()
        page.wait_for_function("window.chatProbe.turns.length === 1")
        page.clock.fast_forward(36000)
        timeout = page.get_by_role("alert").filter(has_text="连接长时间无响应")
        expect(timeout).to_be_visible()
        expect(draft).to_have_value("Keep this question when the connection stalls")

        detail = context.request.get(detail_url).json()
        turn_id = page.evaluate("window.chatProbe.turns[0]")
        answer = "Recovered the saved answer from the stalled connection"
        detail["messages"].append({
            "id": "idle-recovered-chat-answer", "role": "assistant", "content": answer,
            "reading_unit_id": detail["current_unit_id"], "turn_id": turn_id,
        })
        context.route(detail_url, lambda route: route.fulfill(json=detail), times=1)
        send.click()
        expect(page.get_by_text("Partial reply before the stall", exact=True)).to_be_visible()
        page.clock.fast_forward(20000)
        page.evaluate("window.chatProbe.heartbeat()")
        page.clock.fast_forward(20000)
        expect(page.get_by_text("Partial reply before the stall", exact=True)).to_be_visible()
        expect(timeout).to_have_count(0)
        page.clock.fast_forward(16000)
        expect(page.locator(".bubble.assistant").filter(has_text=answer)).to_have_count(1)
        expect(draft).to_have_value("")
        expect(timeout).to_have_count(0)
        assert page.evaluate("window.chatProbe.turns") == [turn_id, turn_id]

        draft.fill("Finish before the server closes the connection")
        send.click()
        page.wait_for_function("window.chatProbe.opened === 2")
        finished_turn = page.evaluate("window.chatProbe.turns.at(-1)")
        finished_answer = "Confirmed without waiting for the connection to close"
        detail["messages"].append({
            "id": "confirmed-open-chat-answer", "role": "assistant", "content": finished_answer,
            "reading_unit_id": detail["current_unit_id"], "turn_id": finished_turn,
        })
        context.route(detail_url, lambda route: route.fulfill(json=detail), times=1)
        page.evaluate("window.chatProbe.finish()")
        expect(page.locator(".bubble.assistant").filter(has_text=finished_answer)).to_have_count(1)
        expect(draft).to_have_value("")

        draft.fill("Preserve this question after cancelling")
        send.click()
        page.wait_for_function("window.chatProbe.opened === 3")
        page.get_by_role("button", name="取消", exact=True).click()
        page.clock.fast_forward(36000)
        expect(timeout).to_have_count(0)
        expect(draft).to_have_value("Preserve this question after cancelling")
        expect(send).to_be_enabled()


def smoke(browser, frontend, backend, *, attachment_viewport=None):
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

    detail_url = f"{backend}/api/papers/{source_id}"
    chat_url = detail_url + "/chat"
    with page.expect_request(chat_url) as first_chat:
        context.route(chat_url, lambda route: route.fulfill(status=503, json={"detail": "精读服务暂不可用"}), times=1)
        page.get_by_role("button", name="发送").click()
    turn_id = first_chat.value.post_data_json["turn_id"]
    expect(page.get_by_role("alert").filter(has_text="精读服务暂不可用")).to_be_visible()
    expect(draft).to_have_value("Keep this draft with the current paper")

    detail = context.request.get(detail_url).json()
    answer = "Recovered answer after the connection closed"
    detail["messages"].append({
        "id": "recovered-chat-answer", "role": "assistant", "content": answer,
        "reading_unit_id": detail["current_unit_id"], "turn_id": turn_id,
    })

    def disconnect_after_commit(route):
        assert route.request.post_data_json["turn_id"] == turn_id
        context.route(detail_url, lambda fresh: fresh.fulfill(json=detail))
        route.fulfill(content_type="text/event-stream",
                      body='data: {"type":"delta","content":"Partial streamed answer"}\n\n')

    context.route(chat_url, disconnect_after_commit, times=1)
    page.reload()
    expect(draft).to_have_value("Keep this draft with the current paper")
    page.get_by_role("button", name="发送").click()
    expect(draft).to_have_value("")
    expect(page.locator(".bubble.assistant").filter(has_text=answer)).to_be_visible()
    expect(page.get_by_text("流式回复未正常结束")).to_have_count(0)
    page.reload()
    expect(draft).to_have_value("")
    expect(page.locator(".bubble.assistant").filter(has_text=answer)).to_have_count(1)
    context.unroute(detail_url)
    page.go_back()
    expect(page.locator(".comparePaper").first).to_be_visible()

    page.get_by_role("tab", name="研究空白").click()
    use_question = page.get_by_role("button", name="用这个问题设计研究")
    question = page.locator(".gapStep").filter(has_text="潜在研究问题").locator(".gapLead").inner_text()
    patches = []

    def interrupt_handoff(route):
        if route.request.method == "PATCH":
            patches.append(route.request.post_data_json)
            if len(patches) == 2:
                assert route.fetch().ok
                route.abort("connectionreset")
        else:
            route.continue_()

    workspace_url = f"{backend}/api/workspace"
    assert context.request.patch(workspace_url, data={"design_idea": "Existing draft before the handoff"}).ok
    context.route(workspace_url, interrupt_handoff)
    with page.expect_request(lambda request: request.method == "PATCH" and request.url == workspace_url):
        use_question.click()
    expect(page.get_by_role("button", name="正在带入研究问题…")).to_be_disabled()
    expect(page.get_by_role("alert").filter(has_text="暂时无法确认工作区是否已保存")).to_be_visible(timeout=16000)
    expect(use_question).to_be_enabled()
    assert context.request.get(workspace_url).json()["design_idea"] == "Existing draft before the handoff"
    use_question.click()
    idea = page.get_by_label("我的研究想法")
    constraints = page.get_by_label("约束条件（可选）")
    expect(idea).to_have_value(question)
    assert len(patches) == 2
    context.unroute(workspace_url)
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
    expired_pages = []

    def search_fixture(route):
        query = parse_qs(urlsplit(route.request.url).query)
        number = int(query["page"][0])
        if number == 2 and not expired_pages:
            assert query["snapshot"] == ["first-batch"]
            expired_pages.append(number)
            route.fulfill(status=409, json={"detail": "当前检索结果已有更新，请点击「刷新结果」后再加载更多。"})
            return
        if number == 2:
            assert query["snapshot"] == ["refreshed-batch"]
        item = papers[number - 1]
        work = {"openalex_id": f"W{number}", "title": item["title"],
                "authors": [], "year": 2020, "journal": "", "doi": "", "abstract": "",
                "citation_count": 0, "oa_pdf_url": None}
        route.fulfill(json={"items": [work], "count": 2, "page": number, "mode": query["mode"][0],
                            "snapshot": "refreshed-batch" if expired_pages else "first-batch"})

    context.route(re.compile(rf"^{re.escape(backend)}/api/research/discover[?]"), search_fixture)
    page.get_by_role("search").get_by_role("textbox").fill(term)
    page.get_by_role("search").get_by_role("button", name="开始检索").click()
    expect(page.get_by_role("textbox", name="论文检索")).to_have_value(term)
    expect(page.locator(".workCard")).to_have_count(1)
    page.get_by_role("button", name="加载更多论文").click()
    expect(page.get_by_role("alert").filter(has_text="当前检索结果已有更新")).to_be_visible()
    expect(page.locator(".workCard")).to_have_count(1)
    page.get_by_role("button", name="刷新结果").click()
    page.get_by_role("button", name="加载更多论文").click()
    expect(page.locator(".workCard")).to_have_count(2)
    page.locator(".researchNav").get_by_role("link", name="深度精读").click()
    expect(page.locator(".reader")).to_be_visible()
    page.go_back()
    expect(page.locator(".workCard")).to_have_count(2)

    # Lose the response to an accepted attachment, then recover its status without resending the PDF.
    previous_viewport = page.viewport_size
    if attachment_viewport:
        page.set_viewport_size(attachment_viewport)
    detail_url = f"{backend}/api/papers/{source_id}"
    source_detail = context.request.get(detail_url).json()
    import_url = f"{backend}/api/research/import"
    attach_url = f"{detail_url}/attach"
    status_url = f"{detail_url}/status"
    context.route(import_url, lambda route: route.fulfill(json={**source_detail, "status": "metadata_only"}), times=1)
    attachments = []

    def disconnect_attachment(route):
        attachments.append(route.request.method)
        route.abort("connectionreset")

    context.route(attach_url, disconnect_attachment)
    context.route(detail_url, lambda route: route.fulfill(json={**source_detail, "status": "uploaded"}), times=1)
    context.route(status_url, lambda route: route.fulfill(status=503, json={}), times=1)
    with page.expect_request(attach_url):
        page.locator(".workCard").first.locator("input[type=file]").set_input_files(
            {"name": "attachment.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4"}
        )
    expect(page.get_by_role("alert").filter(has_text="暂时无法确认 PDF 是否已上传")).to_be_visible()
    expect(page.locator(".workCard")).to_have_count(2)
    statuses = []
    context.route(status_url, lambda route: statuses.append(route))
    context.route(status_url, lambda route: route.fulfill(json={"status": "uploaded"}), times=1)
    with page.expect_request(lambda request: request.url == status_url and "/read?" in request.frame.url):
        page.get_by_role("button", name="核对上传进度", exact=True).click()
    expect(page).to_have_url(re.compile(rf"/read[?]paper={source_id}$"))
    expect(page.get_by_text("PDF 正在解析。", exact=False)).to_be_visible()
    assert attachments == ["POST"]
    context.unroute(attach_url)
    context.route(detail_url, lambda route: route.fulfill(status=503, json={}), times=1)
    assert len(statuses) == 1
    statuses[0].fulfill(json={"status": "parsed"})
    context.unroute(status_url)
    expect(page.get_by_text("暂时无法读取论文状态，正在重试…", exact=True)).to_be_visible()
    expect(page.locator(".pdfCanvas canvas")).to_be_visible(timeout=12000)
    if attachment_viewport:
        page.set_viewport_size(previous_viewport)

    # Use a real PDF from the isolated demo session to verify the deferred upload.
    expect(page.locator(".library .paperItem").first).to_be_visible()
    pdf = context.request.get(f"{backend}/api/papers/{source_id}/file")
    assert pdf.ok
    with page.expect_response(lambda response: "/api/papers?deferred=true&request_id=" in response.url) as uploaded:
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
    papers_url = f"{backend}/api/papers?view=summary"
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


def discovery_relation_race(browser, frontend, backend, *, viewport=None):
    context = browser.new_context(viewport=viewport)
    page = context.new_page()
    initial, newer = "First graph query", "Replacement graph query"
    assert context.request.get(f"{backend}/api/session").ok
    workspace_url = f"{backend}/api/workspace"
    original = context.request.patch(workspace_url, data={"query": "Existing research topic"}).json()
    assert original["query"] and original["selected_paper_ids"] and original["synthesis_id"]

    def work(work_id, title):
        return {"openalex_id": work_id, "title": title, "authors": [], "year": 2021,
                "journal": "", "doi": "", "abstract": "", "citation_count": 0, "oa_pdf_url": None}

    library_url = f"{backend}/api/papers?view=summary"
    library = context.request.get(library_url).json()
    saved_paper = next(paper for paper in library if paper["status"] == "parsed")
    saved_paper["openalex_id"] = "W101"
    context.route(library_url, lambda route: route.fulfill(json=library))
    context.route(library_url, lambda route: route.fulfill(status=503, json={}), times=1)

    def search_fixture(route):
        query = parse_qs(urlsplit(route.request.url).query)
        term = query["q"][0]
        items = ([work("W101", initial)] if term == initial else
                 [work("W102", newer)] if term == newer else [])
        route.fulfill(json={"items": items, "count": len(items), "page": 1, "mode": query["mode"][0]})

    def lineage_fixture(route, title):
        work_id = urlsplit(route.request.url).path.rsplit("/", 1)[1]
        center = work(work_id, title)
        route.fulfill(json={"center": center, "nodes": [{**center, "role": "center"}],
                            "edges": [], "cached": False, "fetched_at": ""})

    search = re.compile(rf"^{re.escape(backend)}/api/research/discover[?]")
    context.route(search, search_fixture)
    old_lineage = f"{backend}/api/research/lineage/W101"
    held = []
    context.route(old_lineage, lambda route: held.append(route), times=1)
    context.route(f"{backend}/api/research/graph/W101", lambda route: route.fulfill(json={
        "nodes": [work("W101", "Constellation center")], "links": [],
    }))

    page.goto(f"{frontend}/discover?{urlencode({'q': initial})}")
    initial_card = page.locator(".workCard").filter(has=page.get_by_role("heading", name=initial, exact=True))
    expect(initial_card.get_by_text("全文状态待确认", exact=True)).to_be_visible()
    expect(initial_card.get_by_text("尚无全文", exact=True)).to_have_count(0)
    page.get_by_role("button", name="重试读取论文库", exact=True).click()
    expect(initial_card.get_by_text("已有全文", exact=True)).to_be_visible()
    expect(initial_card.get_by_role("link", name="打开全文精读")).to_have_attribute("href", f"/read?paper={saved_paper['id']}")
    expect(page.get_by_role("alert").filter(has_text="无法核对论文库")).to_have_count(0)
    topic = page.get_by_role("region", name="研究主题")
    expect(topic).to_contain_text(original["query"])
    assert context.request.get(workspace_url).json() == original
    original_viewport = page.viewport_size
    page.set_viewport_size({"width": 320, "height": 740})
    tray = page.get_by_role("list", name="待综合论文")
    remove_buttons = tray.get_by_role("button", name=re.compile("^移出 "))
    expect(remove_buttons).to_have_count(len(original["selected_paper_ids"]))
    for button in remove_buttons.all():
        box = button.bounding_box()
        assert box and box["width"] >= 44 and box["height"] >= 44, box
        assert box["x"] >= 0 and box["x"] + box["width"] <= 320, box
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    page.set_viewport_size(original_viewport)
    with page.expect_request(old_lineage):
        page.get_by_role("tab", name="文献谱系", exact=True).click()
    page.get_by_role("tab", name="谱系图", exact=True).press("ArrowRight")
    aside = page.locator(".graphAside")
    expect(aside.get_by_role("heading", name="Constellation center")).to_be_visible()
    lineage_fixture(held.pop(), "Lineage center")
    expect(aside.get_by_role("heading", name="Constellation center")).to_be_visible()
    page.get_by_role("tab", name="星座视图").press("ArrowLeft")
    expect(aside.get_by_role("heading", name="Lineage center")).to_be_visible()
    page.get_by_role("tab", name="谱系图", exact=True).press("ArrowRight")
    expect(aside.get_by_role("heading", name="Constellation center")).to_be_visible()

    # Shorten only the production discovery deadlines so the browser can hold
    # real requests in this suite without adding 75 seconds to the run.
    page.evaluate("""() => {
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        AbortSignal.timeout = (delay) => timeout(delay === 30000 || delay === 45000 ? 1500 : delay);
    }""")
    page.get_by_role("tab", name="列表", exact=True).click()
    query = page.get_by_role("textbox", name="论文检索")
    context.route(search, lambda route: held.append(route), times=1)
    query.fill(newer)
    page.get_by_role("button", name="检索论文").click()
    expect(page.get_by_role("alert").filter(has_text="检索超时")).to_be_visible()
    held.pop().abort()
    expect(page.get_by_role("heading", name=initial)).to_be_visible()
    assert parse_qs(urlsplit(page.url).query)["q"] == [initial]
    page.get_by_role("button", name="检索论文").click()
    expect(page.get_by_role("heading", name=newer)).to_be_visible()
    new_lineage = f"{backend}/api/research/lineage/W102"
    context.route(new_lineage, lambda route: held.append(route), times=1)
    context.route(new_lineage + "?refresh=true", lambda route: lineage_fixture(route, "Recovered lineage"))
    page.get_by_role("tab", name="文献谱系", exact=True).click()
    page.get_by_role("tab", name="谱系图", exact=True).click()
    expect(page.get_by_role("alert").filter(has_text="谱系图读取超时")).to_be_visible()
    held.pop().abort()
    page.get_by_role("tab", name="列表", exact=True).click()
    expect(page.get_by_role("alert").filter(has_text="谱系图读取超时")).to_have_count(0)
    page.get_by_role("tab", name="文献谱系", exact=True).click()
    page.get_by_role("button", name="重试读取").click()
    expect(aside.get_by_role("heading", name="Recovered lineage")).to_be_visible()
    query.fill("No results")
    page.get_by_role("button", name="检索论文").click()
    expect(page.get_by_text("没有找到匹配的论文。", exact=False)).to_be_visible()
    expect(aside).to_have_count(0)
    assert context.request.get(workspace_url).json() == original

    query.fill(newer)
    page.get_by_role("button", name="检索论文").click()
    activate = topic.get_by_role("button", name="将本次检索设为研究主题")
    confirm = topic.get_by_role("button", name="确认切换主题")
    activate.click()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2")
    topic.get_by_role("button", name="保留当前主题").click()
    assert context.request.get(workspace_url).json() == original
    activate.click()
    latest = context.request.patch(workspace_url, data={"research_gap": "Saved by another tab"}).json()
    confirm.click()
    expect(page.get_by_role("alert").filter(has_text="工作区已有新进度")).to_be_visible()
    assert context.request.get(workspace_url).json() == latest
    activate.click()
    confirm.click()
    expect(topic.get_by_text(f"当前研究主题 · {newer}", exact=True)).to_be_visible()
    expect(confirm).to_have_count(0)
    changed = context.request.get(workspace_url).json()
    assert changed["query"] == newer and changed["selected_paper_ids"] == []
    archived = context.request.get(f"{backend}/api/research/artifacts?artifact_id={original['synthesis_id']}").json()
    assert archived and archived[0]["id"] == original["synthesis_id"]
    history_url = f"{backend}/api/research/comparisons"
    context.route(history_url, lambda route: route.fulfill(status=503, json={}), times=1)
    page.locator(".researchNav nav").get_by_role("link", name="文献综合").click()
    page.get_by_text("综合历史", exact=True).click()
    page.get_by_role("button", name="重试读取历史").click()
    history = page.locator(".synthesisHistory")
    saved_result = history.locator(f'a[href="/synthesis?artifact={original["synthesis_id"]}"]')
    expect(saved_result).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2")
    saved_result.click()
    expect(page.locator(".synthesisResult")).to_be_focused()
    expect(page.locator(".comparePaper").first).to_be_visible()
    expect(saved_result).to_have_attribute("aria-current", "page")
    assert context.request.get(workspace_url).json() == changed
    page.get_by_role("link", name="返回当前综合").click()
    expect(page.locator(".synthesisResult")).to_have_count(0)
    versions = context.request.get(f"{backend}/api/research/design/history").json()["items"]
    assert versions
    prior_design = versions[0]
    page.locator(".researchNav nav").get_by_role("link", name="科研设计").click()
    page.get_by_text("设计历史", exact=True).click()
    page.locator(f'a[href="/design?version={prior_design["id"]}"]').click()
    expect(page.get_by_role("heading", name=prior_design["goal"], exact=True)).to_be_focused()
    page.locator(".er-stage-main").first.click()
    expect(page.get_by_role("button", name="编辑阶段")).to_have_count(0)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2")
    assert context.request.get(workspace_url).json() == changed
    restore_url = re.compile(rf"^{re.escape(backend)}/api/research/design/versions/[^/]+/restore$")
    held_restore = []
    context.route(restore_url, lambda route: held_restore.append(route), times=1)
    page.get_by_role("button", name="继续编辑此版本").click()
    page.get_by_role("button", name="确认恢复").click()
    expect(page.get_by_role("alert").filter(has_text="暂时无法确认版本是否已恢复")).to_be_visible(timeout=16000)
    held_restore.pop().abort()
    assert parse_qs(urlsplit(page.url).query)["version"] == [prior_design["id"]]
    assert context.request.get(workspace_url).json() == changed

    def drop_restore_response(route):
        assert route.fetch().ok
        route.abort("connectionreset")

    context.route(restore_url, drop_restore_response, times=1)
    page.get_by_role("button", name="继续编辑此版本").click()
    page.get_by_role("button", name="确认恢复").click()
    expect(page.get_by_label("我的研究想法")).to_have_value(prior_design["goal"])
    expect(page.locator(".designGrid")).to_be_visible()
    assert context.request.get(workspace_url).json()["design_version_id"] == prior_design["id"]
    context.close()


def discovery_graph_navigation(browser, frontend, backend, *, related_paper=False):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    if related_paper:
        context.add_init_script("""(() => {
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            return type === "webgl" || type === "webgl2" ? null : getContext.call(this, type, ...args);
          };
        })()""")
    assert context.request.get(f"{backend}/api/session").ok
    library_url = f"{backend}/api/papers?view=summary"
    library = context.request.get(library_url).json()
    saved = next(paper for paper in library if paper["status"] == "parsed")
    saved["openalex_id"] = "W101" if related_paper else "W102"
    context.route(library_url, lambda route: route.fulfill(json=library))

    def work(work_id, title):
        return {"openalex_id": work_id, "title": title, "authors": [], "year": 2020, "journal": "", "doi": "",
                "abstract": "", "citation_count": 0, "oa_pdf_url": None}

    first = work("W101", "First search result")
    center = work("W102", "Chosen lineage center")
    selected = {**first, "role": "reference"}
    lookups = []

    def graph_fixture(route):
        lookups.append(route.request.url.rsplit("/", 1)[-1])
        route.fulfill(json={"center": center, "nodes": [{**center, "role": "center"}, selected], "edges": [
            {"source": "W102", "target": "W101", "relation": "cites"},
        ]})

    def search_fixture(route):
        term = parse_qs(urlsplit(route.request.url).query)["q"][0]
        items = [first, center] if term == "Graph round trip" else [first]
        route.fulfill(json={"items": items, "count": len(items), "page": 1, "mode": "semantic"})

    context.route(re.compile(rf"^{re.escape(backend)}/api/research/discover[?]"), search_fixture)
    context.route(re.compile(rf"^{re.escape(backend)}/api/research/lineage/"), graph_fixture)
    page = context.new_page()
    page.goto(f"{frontend}/discover?{urlencode({'q': 'Graph round trip'})}")
    card = page.locator(".workCard").filter(has_text="Chosen lineage center")
    card.get_by_role("button", name="浏览文献谱系").click()
    aside = page.locator(".graphAside")
    expect(aside.get_by_role("heading", name="Chosen lineage center")).to_be_visible()
    expected_title = "Chosen lineage center"
    if related_paper:
        page.locator(".lg-fallback-main").filter(has_text="First search result").click()
        expected_title = "First search result"
        expect(aside.get_by_role("heading", name=expected_title)).to_be_visible()
    aside.get_by_role("link", name="打开全文精读").click()
    expect(page.get_by_role("heading", name=saved["title"], exact=True)).to_be_visible()
    page.go_back()
    expect(page.get_by_role("tab", name="谱系图", exact=True)).to_have_attribute("aria-selected", "true")
    expect(aside.get_by_role("heading", name=expected_title)).to_be_visible()
    page.reload()
    expect(aside.get_by_role("heading", name=expected_title)).to_be_visible()
    assert set(lookups) == {"W102"}
    page.get_by_role("textbox", name="论文检索").fill("Another query")
    page.get_by_role("button", name="检索论文").click()
    expect(page.get_by_role("tab", name="列表", exact=True)).to_have_attribute("aria-selected", "true")
    expect(aside).to_have_count(0)
    context.close()


def resume_pdf_reading_position(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    assert context.request.get(f"{backend}/api/session").ok
    workspace = context.request.get(f"{backend}/api/workspace").json()
    paper_id = workspace["core_paper_id"]
    paper = context.request.get(f"{backend}/api/papers/{paper_id}").json()
    base = f"{frontend}/read?{urlencode({'paper': paper_id})}"
    page.goto(base)
    expect(page.locator(".pdfCanvas canvas")).to_be_visible()
    page_number = page.locator(".pageTools span").first
    initial = int(page_number.inner_text().split("/")[0])
    offset = 1 if initial < paper["page_count"] else -1
    remembered = initial + offset
    assert remembered > 0
    page.get_by_role("button", name="下一页" if offset > 0 else "上一页", exact=True).click()
    expect(page_number).to_have_text(re.compile(rf"^{remembered} /"))
    fit = page.get_by_role("button", name="适宽", exact=True)
    scale = page.locator(".pageTools span").nth(1)
    fit.click()
    page.get_by_role("button", name="放大 PDF", exact=True).click()
    expect(fit).to_have_attribute("aria-pressed", "false")
    expect(scale).to_have_text("115%")
    navigation = page.locator(".researchNav nav")
    for destination in ("文献综合", "深度精读"):
        navigation.get_by_role("link", name=destination).click()
    expect(page_number).to_have_text(re.compile(rf"^{remembered} /"))
    expect(fit).to_have_attribute("aria-pressed", "false")
    expect(scale).to_have_text("115%")
    chat_tab = page.get_by_role("tab", name="AI 讲解", exact=True)
    chat_tab.click()
    navigation.get_by_role("link", name="文献综合").click()
    navigation.get_by_role("link", name="深度精读").click()
    expect(chat_tab).to_have_attribute("aria-selected", "true")
    expect(page.get_by_role("textbox", name="提出你的科研问题")).to_be_visible()

    citation = urlencode({"page": initial, "source_file": paper["file_version"]})
    page.goto(f"{base}&{citation}")
    expect(page_number).to_have_text(re.compile(rf"^{initial} /"))
    expect(page.get_by_role("tab", name="原文 PDF", exact=True)).to_have_attribute("aria-selected", "true")
    expect(scale).to_have_text("115%")
    page.goto(base)
    expect(chat_tab).to_have_attribute("aria-selected", "true")
    page.get_by_role("tab", name="原文 PDF", exact=True).click()
    expect(page_number).to_have_text(re.compile(rf"^{remembered} /"))
    page.evaluate("""(id) => {
      for (const prefix of ['read-position:', 'pdf-display:']) {
        const key = 'medread-draft:' + prefix + id;
        const saved = JSON.parse(sessionStorage.getItem(key));
        sessionStorage.setItem(key, JSON.stringify({...saved, fileVersion: 'obsolete-version'}));
      }
    }""", paper_id)
    page.reload()
    expect(page_number).to_have_text(re.compile(rf"^{initial} /"))
    expect(fit).to_have_attribute("aria-pressed", "true")
    expect(scale).to_have_text("100%")
    context.close()


def evidence_source_navigation(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    assert context.request.get(f"{backend}/api/session").ok
    workspace_url = f"{backend}/api/workspace"
    workspace = context.request.get(workspace_url).json()
    paper_id = next(item for item in workspace["selected_paper_ids"] if item != workspace["core_paper_id"])
    paper = context.request.get(f"{backend}/api/papers/{paper_id}").json()
    starting_page = next((unit["page_start"] for unit in paper["units"] if unit["id"] == paper["current_unit_id"]), 1) or 1
    target = 2 if starting_page != 2 else 1
    assert paper["page_count"] >= 2
    view_url = f"{backend}/api/research/comparisons/{workspace['synthesis_id']}?view=evidence"
    result = context.request.get(view_url).json()
    reference = {"paper_id": paper_id, "unit_id": "fixture", "section": "Results",
                 "page": target, "page_start": target, "page_end": target, "snippet": "Example citation.",
                 "quote_verified": True, "file_version": paper["file_version"]}
    result["payload"]["controversies"] = [
        {"claim": "Different evidence check", "reason": "Another claim", "stance": "INSUFFICIENT",
         "paper_ids": [paper_id]},
        {"claim": "Evidence navigation check", "reason": "Compare source versions", "stance": "SUPPORTS",
         "paper_ids": [paper_id], "evidence_refs": [reference, {**reference, "page": None, "page_end": target + 1}]},
    ]
    context.route(view_url, lambda route: route.fulfill(json=result))
    page.goto(f"{frontend}/synthesis?view=evidence")
    claim = page.get_by_role("button", name=re.compile("^Evidence navigation check"))
    claim.click()
    expect(page.get_by_role("link", name=f"从第 {target} 页开始核对 ↗")).to_be_visible()
    link = page.get_by_role("link", name=f"打开原文第 {target} 页 ↗")
    params = parse_qs(urlsplit(link.get_attribute("href")).query)
    assert params["source_file"] == [paper["file_version"]]
    held_reads = []
    detail_url = f"{backend}/api/papers/{paper_id}"
    library_url = f"{backend}/api/papers?view=summary"
    context.route(detail_url, lambda route: held_reads.append(route), times=1)
    context.route(library_url, lambda route: held_reads.append(route), times=1)
    link.click()
    expect(page.get_by_role("heading", name="正在打开论文…")).to_be_visible()
    expect(page.get_by_role("alert").filter(has_text="读取论文超时")).to_be_visible(timeout=16000)
    expect(page.get_by_text("让阅读从原文开始")).to_have_count(0)
    assert parse_qs(urlsplit(page.url).query) == params
    assert len(held_reads) == 2
    for held in held_reads:
        held.abort()
    page.get_by_role("button", name="重试打开论文").click()
    page_number = page.locator(".pageTools span").first
    expect(page_number).to_have_text(re.compile(rf"^{target} /"))
    expect(page.locator(".pdfCanvas canvas")).to_be_visible()
    chat_tab = page.get_by_role("tab", name="AI 讲解", exact=True)
    chat_tab.click()
    chat_url = detail_url + "/chat"
    context.route(chat_url, lambda route: route.fulfill(status=503, json={"detail": "精读服务暂不可用"}), times=1)
    question = page.get_by_role("textbox", name="提出你的科研问题")
    question.fill("Question with the paper library offline")
    with page.expect_request(chat_url):
        page.get_by_role("button", name=re.compile(r"^发送")).click()
    expect(page.get_by_role("alert").filter(has_text="精读服务暂不可用")).to_be_visible()
    expect(question).to_have_value("Question with the paper library offline")
    page.get_by_role("tab", name="原文 PDF", exact=True).click()
    page.get_by_role("button", name="展开论文库").click()
    drawer = page.get_by_role("dialog", name="论文库")
    expect(drawer.get_by_role("alert").filter(has_text="暂时无法读取论文库")).to_be_visible()
    upload_url = re.compile(rf"^{re.escape(backend)}/api/papers\?deferred=true&request_id=")
    context.route(upload_url, lambda route: route.fulfill(status=422, json={"detail": "PDF 上传验证"}), times=1)
    with page.expect_request(upload_url):
        drawer.locator('input[type="file"]').set_input_files({
            "name": "library-offline.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-",
        })
    expect(page.get_by_role("alert").filter(has_text="PDF 上传验证")).to_be_visible()
    page.get_by_role("button", name="展开论文库").click()
    drawer.get_by_role("button", name="重试读取论文库").click()
    expect(drawer.locator(".paperItem[aria-current=true]")).to_contain_text(paper["title"])
    drawer.get_by_role("button", name="关闭论文库", exact=True).click()
    assert context.request.get(workspace_url).json()["core_paper_id"] == workspace["core_paper_id"]
    assert context.request.patch(workspace_url, data={"synthesis_id": None}).ok
    page.go_back()
    evidence = page.get_by_role("dialog", name="Evidence navigation check", exact=True)
    expect(evidence.get_by_role("link", name=f"打开原文第 {target} 页 ↗")).to_be_visible()
    close_evidence = evidence.get_by_role("button", name="关闭详情", exact=True)
    expect(close_evidence).to_be_focused()
    page.set_viewport_size({"width": 320, "height": 256})
    evidence.evaluate("node => { node.scrollTop = node.scrollHeight; }")
    assert evidence.evaluate("node => node.scrollTop > 100")
    expect(close_evidence).to_be_in_viewport(ratio=1)
    expect(evidence.get_by_role("link", name=f"从第 {target} 页开始核对 ↗")).to_be_in_viewport(ratio=1)
    assert parse_qs(urlsplit(page.url).query)["artifact"] == [workspace["synthesis_id"]]
    page.keyboard.press("Escape")
    expect(evidence).to_have_count(0)
    expect(claim).to_be_focused()
    page.set_viewport_size({"width": 390, "height": 844})
    assert "claim" not in parse_qs(urlsplit(page.url).query)
    assert context.request.patch(workspace_url, data={"synthesis_id": workspace["synthesis_id"]}).ok
    stale = urlencode({"paper": paper_id, "page": target, "source_file": "old-pdf-version"})
    page.goto(f"{frontend}/read?{stale}")
    expect(page.get_by_role("status").filter(has_text="旧引用的页码与当前 PDF 无法确认对应")).to_be_visible()
    expect(page_number).to_have_text(re.compile(rf"^{starting_page} /"))
    page.get_by_role("button", name="按当前 PDF 继续").click()
    expect(page.get_by_role("status").filter(has_text="旧引用的页码与当前 PDF 无法确认对应")).to_have_count(0)
    assert "source_file" not in parse_qs(urlsplit(page.url).query)
    invalid = urlencode({"paper": paper_id, "page": paper["page_count"] + 1})
    page.goto(f"{frontend}/read?{invalid}")
    expect(page.get_by_role("status").filter(has_text="页码不在这份 PDF 内")).to_be_visible()
    expect(page_number).to_have_text(re.compile(rf"^{starting_page} /"))
    page.goto(f"{frontend}/read")
    expect(page.get_by_role("heading", name=paper["title"], exact=True)).to_be_visible()
    page.get_by_role("button", name="展开论文库").click()
    drawer = page.get_by_role("dialog", name="论文库")

    def fail_center_write(route):
        if route.request.method == "PATCH":
            route.fulfill(status=503, json={"detail": "暂时无法保存中心论文"})
        else:
            route.fallback()

    context.route(workspace_url, fail_center_write)
    center = drawer.get_by_role("button", name="设为中心论文", exact=True)
    center.click()
    expect(drawer.get_by_role("alert").filter(has_text="暂时无法保存中心论文")).to_be_visible()
    assert context.request.get(workspace_url).json()["core_paper_id"] == workspace["core_paper_id"]
    context.unroute(workspace_url, fail_center_write)
    center.click()
    expect(drawer.get_by_role("status").filter(has_text="当前为中心论文")).to_be_visible()
    assert context.request.get(workspace_url).json()["core_paper_id"] == paper_id
    context.close()


def synthesis_view_loading(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    assert context.request.get(f"{backend}/api/session").ok
    workspace = context.request.get(f"{backend}/api/workspace").json()
    path = f"{backend}/api/research/comparisons/{workspace['synthesis_id']}"
    requested = []
    page.on("request", lambda request: requested.append(request.url) if request.url.startswith(path + "?") else None)
    page.goto(f"{frontend}/synthesis")
    expect(page.locator(".comparePaper").first).to_be_visible()
    assert requested == [path + "?view=matrix"]
    checks = page.locator(".selectionList input:checked")
    expand = page.get_by_role("button", name="更换对比论文", exact=True)
    expand.click()
    expect(checks).to_have_count(len(workspace["selected_paper_ids"]))
    page.get_by_role("button", name="收起论文列表", exact=True).click()
    library_url = f"{backend}/api/papers?view=summary"
    context.route(library_url, lambda route: route.fulfill(status=503, json={}), times=1)
    page.evaluate("window.dispatchEvent(new Event('focus'))")
    stale = page.get_by_role("alert").filter(has_text="当前显示上次读取的论文状态")
    expect(stale).to_be_visible()
    expand.click()
    expect(checks).to_have_count(len(workspace["selected_paper_ids"]))
    expect(page.locator(".comparePaper").first).to_be_visible()
    libraries = []
    context.route(library_url, lambda route: libraries.append(route))
    with page.expect_request(library_url):
        page.get_by_role("button", name="重试读取论文库").click()
    expect(page.get_by_role("button", name="正在重试…")).to_be_disabled()
    expect(stale).to_be_visible()
    page.evaluate("for (let i = 0; i < 3; i++) window.dispatchEvent(new Event('focus'))")
    papers = context.request.get(library_url).json()
    changed = next(paper for paper in papers if paper["id"] == workspace["selected_paper_ids"][0])
    changed["status"] = "failed"
    assert len(libraries) == 1
    libraries[0].fulfill(json=papers)
    context.unroute(library_url)
    expect(stale).to_have_count(0)
    expect(page.get_by_text(f"{changed['title']} · PDF 解析失败", exact=True)).to_be_visible()
    expect(checks).to_have_count(len(workspace["selected_paper_ids"]) - 1)
    count = len(workspace["selected_paper_ids"])
    expect(page.get_by_role("heading", name=re.compile(r"^选择论文"))).to_contain_text(f"{count} / 5")
    expect(page.locator(".comparePaper").first).to_be_visible()

    evidence = page.get_by_role("tab", name="证据关系", exact=True)
    matrix = page.get_by_role("tab", name="论文对比", exact=True)
    held = []
    context.route(path + "?view=evidence", lambda route: held.append(route), times=1)
    with page.expect_request(path + "?view=evidence"):
        evidence.click()
    expect(page.get_by_role("status").filter(has_text="正在打开证据关系")).to_be_visible()
    matrix.click()
    expect(page.locator(".comparePaper").first).to_be_visible()
    assert requested.count(path + "?view=matrix") == 1
    held[0].fulfill(status=503, json={})
    expect(page.get_by_role("alert").filter(has_text="暂时无法读取这个综合视图")).to_have_count(0)
    context.route(path + "?view=evidence", lambda route: route.fulfill(status=503, json={}), times=1)
    evidence.click()
    script = re.compile(rf"^{re.escape(frontend)}/_next/static/chunks/(?:\d+\.[a-f0-9]+|[^/]*EvidenceMap[^/]*)\.js(?:\?.*)?$")
    blocked = []

    def drop_panel_script(route):
        blocked.append(route.request.url)
        route.abort("internetdisconnected")

    context.route(script, drop_panel_script, times=1)
    page.get_by_role("button", name="重试读取视图").click()
    expect(page.get_by_role("button", name="重试打开证据关系")).to_be_visible()
    assert blocked
    expect(page.locator(".researchNav")).to_be_visible()
    page.get_by_role("button", name="重试打开证据关系").click()
    expect(page.get_by_text("文献证据关系", exact=True)).to_be_visible()
    matrix.click()
    evidence.click()
    expect(page.get_by_text("文献证据关系", exact=True)).to_be_visible()
    assert requested.count(path + "?view=evidence") == 3
    requested.clear()
    page.goto(f"{frontend}/synthesis?view=gaps&artifact={workspace['synthesis_id']}")
    expect(page.get_by_role("button", name="用这个问题设计研究")).to_be_visible()
    assert requested == [path + "?view=gaps"]
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2")
    broken = context.request.get(path + "?view=matrix").json()
    broken["payload"]["dimensions"] = None
    context.route(path + "?view=matrix", lambda route: route.fulfill(json=broken), times=1)
    page.goto(f"{frontend}/synthesis")
    expect(page.get_by_role("heading", name="这个页面暂时无法打开")).to_be_visible()
    expect(page.locator(".researchNav")).to_be_visible()
    page.get_by_role("button", name="重试页面").click()
    expect(page.locator(".comparePaper").first).to_be_visible()
    context.close()


def history_list_navigation(browser, frontend, backend):
    for scope in ("design", "synthesis"):
        context = browser.new_context(viewport={"width": 390, "height": 844})
        assert context.request.get(f"{backend}/api/session").ok
        workspace = context.request.get(f"{backend}/api/workspace").json()
        if scope == "design":
            endpoint = f"{backend}/api/research/design/history"
            artifact_id = workspace["design_version_id"]
            version = context.request.get(
                f"{backend}/api/research/design/versions?artifact_id={artifact_id}"
            ).json()[0]
            assert context.request.post(f"{backend}/api/research/design/manual",
                                        data={"artifact_id": artifact_id, "design": version["payload"]}).ok
            first, older = context.request.get(endpoint).json()["items"][:2]
            historical = f"{frontend}/design?{urlencode({'version': older['id']})}"
            expected_label = older["goal"]
            title = "设计历史"
        else:
            endpoint = f"{backend}/api/research/comparisons"
            first = context.request.get(endpoint).json()["items"][0]
            older = {**first, "id": "historical-comparison-fixture", "titles": ["Older saved comparison"]}
            historical = f"{frontend}/synthesis?{urlencode({'artifact': older['id']})}"
            matrix = context.request.get(f"{endpoint}/{first['id']}?view=matrix").json()
            context.route(f"{endpoint}/{older['id']}?view=matrix",
                          lambda route: route.fulfill(json={**matrix, "id": older["id"]}))
            expected_label = "Older saved comparison"
            title = "综合历史"

        reads = []
        newest = None

        def history_fixture(route):
            cursor = parse_qs(urlsplit(route.request.url).query).get("before", [None])[0]
            reads.append(cursor)
            if cursor is None:
                items = [newest, first] if newest else [first]
                route.fulfill(json={"items": items, "next_before": first["id"]})
            else:
                assert cursor == first["id"]
                route.fulfill(json={"items": [older], "next_before": None})

        context.route(re.compile(rf"^{re.escape(endpoint)}(?:[?].*)?$"), history_fixture)
        page = context.new_page()
        page.goto(f"{frontend}/{scope}")
        history = page.locator(".synthesisHistory")
        history.get_by_text(title, exact=True).click()
        history.get_by_role("button", name="加载更早的记录").click()
        link = history.locator(f'[href="{urlsplit(historical).path}?{urlsplit(historical).query}"]')
        expect(link).to_have_text(expected_label)
        link.click()
        expect(page).to_have_url(historical)
        page.go_back()
        expect(link).to_be_focused()
        expect(history.locator("li")).to_have_count(2)
        assert reads == [None, first["id"]]
        page.reload()
        expect(link).to_be_visible()
        assert reads == [None, first["id"]]
        history.get_by_text(title, exact=True).click()
        expect(link).to_be_hidden()
        with page.expect_response(endpoint):
            history.get_by_text(title, exact=True).click()
        expect(link).to_be_visible()
        assert reads == [None, first["id"], None]
        if scope == "design":
            updated = context.request.post(f"{backend}/api/research/design/manual",
                                           data={"artifact_id": first["id"], "design": version["payload"]}).json()
            newest = {**first, "id": updated["id"], "number": updated["version"]["number"]}
            page.evaluate("window.dispatchEvent(new Event('focus'))")
            expect(history.locator(f'a[href="/design?version={newest["id"]}"]')).to_have_attribute("aria-current", "page")
            expect(link).to_be_visible()
            expect(history.locator("li")).to_have_count(3)
            assert reads == [None, first["id"], None, None]
            context.clear_cookies()
            page.reload()
            expect(page.get_by_label("我的研究想法")).to_be_enabled()
            expect(history.locator("li")).to_have_count(0)
        context.close()


def design_view_navigation(browser, frontend, backend):
    context = browser.new_context(viewport={"width": 390, "height": 844})
    assert context.request.get(f"{backend}/api/session").ok
    workspace_url = f"{backend}/api/workspace"
    workspace = context.request.get(workspace_url).json()
    version_id = workspace["design_version_id"]
    version_url = f"{backend}/api/research/design/versions?artifact_id={version_id}"
    version = context.request.get(version_url).json()[0]
    design = version["payload"]
    source_id = design["research_origin"]["synthesis_id"]
    design["research_origin"]["research_gap"] = ""
    context.route(version_url, lambda route: route.fulfill(json=[version]))
    novelty_id = "saved-novelty-navigation-fixture"
    novelty = {"query": workspace["design_idea"], "similar_papers": [], "similarity_level": "待核验",
               "differences": [], "novel_angles": [], "evidence_scope": "Fixture"}
    context.route(workspace_url, lambda route: route.fulfill(json={**workspace, "novelty_id": novelty_id}))
    novelty_url = f"{backend}/api/research/artifacts?kind=novelty_analysis&artifact_id={novelty_id}"
    context.route(novelty_url, lambda route: route.fulfill(json=[{"id": novelty_id, "payload": novelty}]))

    page = context.new_page()
    page.goto(f"{frontend}/design")
    novelty_tab = page.get_by_role("tab", name="新颖性扫描")
    canvas_tab = page.get_by_role("tab", name="设计沙盘")
    expect(page.get_by_role("heading", name=re.compile("^新颖性扫描"))).to_be_visible()
    novelty_tab.focus()
    novelty_tab.press("ArrowRight")
    expect(canvas_tab).to_be_focused()
    expect(canvas_tab).to_have_attribute("aria-selected", "true")
    expect(page).to_have_url(f"{frontend}/design?view=canvas")

    stage = page.locator(".er-stage-main").first
    stage.click()
    expect(stage).to_have_attribute("aria-expanded", "true")
    constraints = page.get_by_label("约束条件（可选）")
    constraints.fill("Keep the plan draft while checking the source")
    page.get_by_text("本版本的研究起点与依据", exact=True).click()
    page.get_by_role("link", name="打开本版本的文献综合").click()
    expect(page).to_have_url(f"{frontend}/synthesis?view=gaps&artifact={source_id}")
    page.go_back()
    expect(canvas_tab).to_have_attribute("aria-selected", "true")
    expect(stage).to_have_attribute("aria-expanded", "true")
    expect(constraints).to_have_value("Keep the plan draft while checking the source")

    novelty_tab.click()
    expect(page).to_have_url(f"{frontend}/design?view=novelty")
    page.reload()
    expect(novelty_tab).to_have_attribute("aria-selected", "true")
    expect(page.get_by_role("heading", name=re.compile("^新颖性扫描"))).to_be_visible()
    canvas_tab.click()
    expect(stage).to_have_attribute("aria-expanded", "true")
    assert context.request.get(workspace_url).json() == workspace
    context.close()


def keyboard_navigation(browser, frontend, viewport=None):
    context = browser.new_context(viewport=viewport)
    page = context.new_page()
    page.goto(f"{frontend}/discover")
    main = page.get_by_role("main")
    skip = page.get_by_role("link", name="跳到主要内容")
    page.keyboard.press("Tab")
    expect(skip).to_be_focused()
    skip.press("Enter")
    expect(main).to_be_focused()
    page.keyboard.press("Tab")
    expect(page.get_by_role("textbox", name="论文检索")).to_be_focused()
    expect(page).to_have_title("文献发现 · MedRead")

    for path, title in [("/read", "深度精读"), ("/synthesis", "文献综合"), ("/design", "科研设计")]:
        target = page.locator(f'.researchNav nav a[href="{path}"]')
        target.focus()
        target.press("Enter")
        expect(target).to_have_attribute("aria-current", "page")
        expect(main).to_be_focused()
        expect(page).to_have_title(f"{title} · MedRead")

    page.go_back()
    expect(main).to_be_focused()
    expect(page).to_have_title("文献综合 · MedRead")
    evidence = page.get_by_role("tab", name="证据关系")
    evidence.focus()
    evidence.press("Enter")
    expect(evidence).to_be_focused()
    expect(evidence).to_have_attribute("aria-selected", "true")

    brand = page.locator(".navBrand")
    brand.focus()
    brand.press("Enter")
    expect(page).to_have_url(f"{frontend}/")
    expect(main).to_be_focused()
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
            reader_chat_idle_recovery(browser, args.frontend, args.backend)
            reader_delete_recovery(browser, args.frontend, args.backend)
            keyboard_navigation(browser, args.frontend, viewport={"width": 390, "height": 844})
            design_view_navigation(browser, args.frontend, args.backend)
            history_list_navigation(browser, args.frontend, args.backend)
            background_jobs(browser, args.frontend, args.backend)
            reopen_saved_job_result(browser, args.frontend, args.backend)
            reload_before_job_confirmation(browser, args.frontend, args.backend)
            reload_before_upload_confirmation(browser, args.frontend, args.backend)
            manual_design_draft(browser, args.frontend, args.backend)
            stage_experiment_draft(browser, args.frontend, args.backend)
            pdf_search_recovery(browser, args.frontend, args.backend)
            compact_reading(browser, args.frontend, args.backend)
            shared_selection(browser, args.frontend, args.backend)
            cross_tab_paper_library(browser, args.frontend, args.backend)
            pending_pdf_selection(browser, args.frontend, args.backend)
            reader_reparse(browser, args.frontend, args.backend)
            reader_reparse_recovery(browser, args.frontend, args.backend)
            discovery_relation_race(browser, args.frontend, args.backend)
            discovery_graph_navigation(browser, args.frontend, args.backend)
            synthesis_view_loading(browser, args.frontend, args.backend)
            evidence_source_navigation(browser, args.frontend, args.backend)
            resume_pdf_reading_position(browser, args.frontend, args.backend)
        finally:
            browser.close()
    print("MedRead navigation smoke passed")
