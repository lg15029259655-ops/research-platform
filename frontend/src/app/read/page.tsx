"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { type CSSProperties, type KeyboardEvent, ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { API, postJson } from "@/lib/api";
import ResearchNav from "@/components/ResearchNav";
import XRayPanel from "@/components/XRayPanel";
import FigureStoryboard from "@/components/FigureStoryboard";
import { updateWorkspace } from "@/lib/workspace";
import { tabGroup } from "@/lib/tabs";
import "../research.css";
import "./enhancements.css";
import "../studio.css";

const PdfPane = dynamic(() => import("@/components/PdfPane"), { ssr: false });
type Unit = { id: string; position: number; kind: string; heading: string; page_start: number | null; actual_pdf_page?: number | null; caption?: string | null; evidence_snippet?: string | null };
type Message = { id: string; role: string; content: string; reading_unit_id: string | null; visual_verified?: boolean };
type Paper = { id: string; title: string; original_filename: string; current_unit_id: string | null; status: string; abstract?: string | null; year?: number | null; journal?: string | null; units?: Unit[]; messages?: Message[]; warning?: string; page_count?: number };
type XRay = { question: string; domain: string; study_type: string; limitations: string[]; stages: { key: string; label: string; summary: string; unit_ids: string[] }[] };
type Action = "START" | "NEXT" | "NAVIGATE" | "FIGURE" | "WHY_DESIGN" | "EVIDENCE" | "QUESTION";
type Mode = "split" | "pdf" | "ai";

function SummaryCards({ content }: { content: string }) {
  const parts = [...content.matchAll(/【([^】]+)】([\s\S]*?)(?=【[^】]+】|$)/g)];
  if (parts.length < 3) return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
  return <div className="summaryGrid">{parts.map((part, index) => <article className="summaryCard" key={index}><h3>{part[1]}</h3>{part[1] === "关系图" ? <div className="relationFlow">{part[2].trim().split("\n").filter(Boolean).map((line, i) => { const nodes = line.replace(/^[-*]\s*/, "").split(/\s*(?:->|→)\s*/); return nodes.length === 2 ? <div className="relationEdge" key={i}><span>{nodes[0]}</span><b>→</b><span>{nodes[1]}</span></div> : <div key={i}>{line}</div>; })}</div> : <div><ReactMarkdown remarkPlugins={[remarkGfm]}>{part[2].trim()}</ReactMarkdown></div>}</article>)}</div>;
}

export default function ReadPage() {
  const [ready, setReady] = useState(false);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [parseStage, setParseStage] = useState("");
  const [stream, setStream] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("split");
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [pdfWidth, setPdfWidth] = useState(38);
  const [activeHeading, setActiveHeading] = useState("");
  const [page, setPage] = useState(1);
  const [readerTab, setReaderTab] = useState<"read" | "xray" | "storyboard">("read");
  const [xray, setXray] = useState<XRay | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const modeTabs = tabGroup(["split", "pdf", "ai"] as const, mode, setMode);
  const readerTabs = tabGroup(["read", "xray", "storyboard"] as const, readerTab, setReaderTab);
  // X-Ray 请求的 in-flight 令牌。pending 与同页其它请求共用，不能拿来判重；
  // loadPaper 里把它清空，顺带让「切论文后旧响应才回来」的串台失效。
  const xrayRequest = useRef<symbol | null>(null);
  const libraryUploadRef = useRef<HTMLInputElement>(null);
  const welcomeUploadRef = useRef<HTMLInputElement>(null);
  const attachUploadRef = useRef<HTMLInputElement>(null);
  // 上传入口的键盘等价：<input hidden> 是 display:none，不在 tab 序，外包的 <label> 也不可聚焦（ux-spec D1）。
  function openUpload(event: KeyboardEvent<HTMLLabelElement>, input: HTMLInputElement | null) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    input?.click();
  }

  const loadList = useCallback(async () => {
    const res = await fetch(`${API}/api/papers`, { credentials: "include" });
    if (!res.ok) throw new Error("无法读取论文列表");
    setPapers(await res.json());
  }, []);
  const loadPaper = useCallback(async (id: string) => {
    const res = await fetch(`${API}/api/papers/${id}`, { credentials: "include" });
    if (!res.ok) throw new Error("无法读取论文记录");
    const data: Paper = await res.json();
    followLatest.current = true;
    setPaper(data);
    updateWorkspace({core_paper_id: id}).catch(() => {});
    setReaderTab("read"); setXray(null); xrayRequest.current = null;
    const current = data.units?.find((unit) => unit.id === data.current_unit_id);
    const requestedPage = Number(new URLSearchParams(window.location.search).get("page"));
    if (Number.isInteger(requestedPage) && requestedPage > 0 && requestedPage <= (data.page_count || 0)) setPage(requestedPage);
    else if (current?.page_start) setPage(current.page_start);
    window.history.replaceState({}, "", `/read?paper=${id}`);
  }, []);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("reader-pdf-width"));
    if (saved >= 30 && saved <= 70) setPdfWidth(saved);
    async function initialize() {
      const session = await fetch(`${API}/api/session`, { credentials: "include" });
      if (!session.ok) throw new Error("无法建立匿名会话");
      setReady(true);
      await loadList();
      const selected = new URLSearchParams(window.location.search).get("paper");
      if (selected) await loadPaper(selected);
    }
    initialize().catch((e) => setError(e.message));
  }, [loadList, loadPaper]);

  useEffect(() => {
    const container = messagesRef.current;
    const assistants = container?.querySelectorAll<HTMLElement>(".bubble.assistant");
    const latest = assistants?.[assistants.length - 1];
    if (container && latest) {
      container.scrollTop += latest.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
      followLatest.current = false;
    }
  }, [paper?.id, paper?.messages?.length]);
  useEffect(() => {
    const container = messagesRef.current;
    if (container && stream && followLatest.current) container.scrollTop = container.scrollHeight;
  }, [stream]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !ready) return;
    setPending(true); setError(""); setParseStage("正在上传 PDF…");
    try {
      const body = new FormData(); body.append("file", file);
      const res = await fetch(`${API}/api/papers?deferred=true`, { method: "POST", credentials: "include", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "上传失败");
      const stages: Record<string, string> = { uploaded: "正在读取 PDF…", reading: "正在提取每页文字…", structure: "正在识别论文章节…", figures: "正在定位主文 Figure 和 Table…", manifest: "正在建立阅读目录…", images: "正在提取页面图像…" };
      let parsed: Paper | null = null;
      for (let attempt = 0; attempt < 240; attempt++) {
        const poll = await fetch(`${API}/api/papers/${data.id}`, { credentials: "include" });
        if (!poll.ok) throw new Error("论文读取失败，请稍后重试");
        const progress: Paper & { status: string } = await poll.json();
        setParseStage(stages[progress.status] || "正在解析论文…");
        if (progress.status === "failed") throw new Error("PDF 解析失败，请重试");
        if (progress.status === "parsed") { parsed = progress; break; }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!parsed) throw new Error("解析仍在进行，请稍后从论文库打开");
      await loadList(); await loadPaper(data.id); setPage(1);
      if (parsed.warning) setError(parsed.warning);
    } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); }
    finally { setPending(false); setParseStage(""); event.target.value = ""; }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !paper) return;
    setPending(true); setError(""); setParseStage("正在上传并解析全文 PDF…");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`${API}/api/papers/${paper.id}/attach`, { method: "POST", credentials: "include", body });
      if (!response.ok) { const data = await response.json(); throw new Error(data.detail || "上传失败"); }
      for (let attempt = 0; attempt < 240; attempt++) {
        const status = await fetch(`${API}/api/papers/${paper.id}`, { credentials: "include" });
        if (!status.ok) throw new Error("论文读取失败，请稍后重试");
        const latest: Paper = await status.json();
        if (latest.status === "failed") throw new Error("PDF 解析失败，请重试");
        if (latest.status === "parsed") { await loadPaper(paper.id); await loadList(); return; }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("解析仍在进行，请稍后从论文库打开");
    } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); }
    finally { setPending(false); setParseStage(""); event.target.value = ""; }
  }

  async function reparse() {
    if (!paper || pending || !window.confirm("重新解析会清除这篇论文的旧精读记录及相关综合结果，原 PDF 会保留。继续吗？")) return;
    const id = paper.id;
    setPending(true); setError(""); setParseStage("正在用新版规则重新解析 PDF…");
    try {
      const response = await fetch(`${API}/api/papers/${id}/reparse`, { method: "POST", credentials: "include" });
      if (!response.ok) { const data = await response.json(); throw new Error(data.detail || "重新解析失败"); }
      for (let attempt = 0; attempt < 240; attempt++) {
        const status = await fetch(`${API}/api/papers/${id}`, { credentials: "include" });
        if (!status.ok) throw new Error("无法读取解析进度");
        const latest: Paper = await status.json();
        if (latest.status === "failed") throw new Error("重新解析失败，请检查 PDF");
        if (latest.status === "parsed") {
          await loadPaper(id); await loadList();
          if (latest.warning) setError(latest.warning);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      throw new Error("解析仍在进行，请稍后重新打开论文");
    } catch (e) { setError(e instanceof Error ? e.message : "重新解析失败"); }
    finally { setPending(false); setParseStage(""); }
  }

  async function openXRay() {
    if (!paper || paper.status !== "parsed") return;
    setReaderTab("xray");
    // 键盘切到「结构分析」后连按回车会在首个响应回来前重复触发——只判 xray 挡不住第二次。
    if (xray || xrayRequest.current) return;
    const token = Symbol(paper.id);
    xrayRequest.current = token;
    setPending(true); setError("");
    try {
      const data = await postJson<{ payload: XRay }>(`/api/research/xray/${paper.id}`, {});
      if (xrayRequest.current === token) setXray(data.payload);
    }
    catch (e) { if (xrayRequest.current === token) setError(e instanceof Error ? e.message : "结构分析失败"); }
    finally { xrayRequest.current = null; setPending(false); }
  }

  function jumpTo(unitId: string) {
    const unit = paper?.units?.find((item) => item.id === unitId);
    if (unit?.page_start) setPage(unit.page_start);
    setMode("split"); setReaderTab("read");
  }

  async function act(action: Action, message?: string) {
    if (!paper || !ready || pending) return;
    setPending(true); setError(""); setStream(""); setActiveHeading(""); followLatest.current = true;
    try {
      const res = await fetch(`${API}/api/papers/${paper.id}/chat`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, message, unit_id: action === "NAVIGATE" ? message : undefined }),
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.detail || "请求失败"); }
      if (!res.body) throw new Error("浏览器未收到流式响应");
      const reader = res.body.getReader(); const decoder = new TextDecoder();
      let buffer = ""; let answer = ""; let completed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n"); buffer = events.pop() || "";
        for (const raw of events) {
          const line = raw.split("\n").find((part) => part.startsWith("data: "));
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          if (data.type === "delta") { answer += data.content; setStream(answer); }
          if (data.type === "reset") { answer = ""; setStream(""); }
          if (data.type === "selected") { if (data.page) setPage(data.page); setActiveHeading(data.heading || ""); }
          if (data.type === "error") throw new Error(data.message);
          if (data.type === "done") completed = true;
        }
      }
      if (!completed) throw new Error("流式回复未正常结束");
      await loadPaper(paper.id); await loadList(); setStream("");
      if (action === "QUESTION") setDraft("");
    } catch (e) { setError(e instanceof Error ? e.message : "精读失败"); }
    finally { setPending(false); setActiveHeading(""); }
  }

  async function removePaper(id: string) {
    if (!window.confirm("删除这篇论文及其聊天记录？此操作无法恢复。")) return;
    setError("");
    const response = await fetch(`${API}/api/papers/${id}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) { setError("删除论文失败，请重试"); return; }
    if (paper?.id === id) { setPaper(null); setStream(""); window.history.replaceState({}, "", "/read"); }
    await loadList();
  }

  const current = paper?.units?.find((unit) => unit.id === paper.current_unit_id);
  const units = paper?.units || [];
  // 「解析成功但一个阅读单元都没有」是后端能给出的真实信号，比按标题字面量判断可靠：
  // 原先写死的 "hhs public access" 只是某一篇种子论文的标题，换一篇空解析的论文就不提示了。
  const needsReparse = !!paper && paper.status === "parsed"
    && (units.length === 0 || !!paper.warning?.includes("未可靠识别论文章节"));
  const next = units[current ? current.position + 1 : 0];
  const figures = units.filter((unit) => unit.kind === "FIGURE");
  const figureIndex = current?.kind === "FIGURE" ? figures.findIndex((unit) => unit.id === current.id) + 1 : 0;
  const nextLabel = !current ? "开始精读 · 题目与摘要" : next?.kind === "FIGURE" ? `进入 ${next.heading}` : next?.kind === "RECAP" ? "全文总结" : next ? next.kind === "DISCUSSION" ? "进入 Discussion" : "下一部分" : "已读完";
  return <div className="readerShell"><ResearchNav current="/read" /><main id="main" className={`reader ${libraryOpen ? "" : "libraryClosed"}`}>
    {libraryOpen && <aside className="library">
      <div className="libraryHeading"><span>论文库</span><label className="uploadBtn" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, libraryUploadRef.current)}>+ 上传 PDF<input ref={libraryUploadRef} type="file" accept="application/pdf,.pdf" onChange={upload} disabled={pending} hidden /></label></div>
      <div className="libraryList">{papers.length ? papers.map((item) => <div className="paperRow" key={item.id}><button className={`paperItem ${paper?.id === item.id ? "selected" : ""}`} onClick={() => { loadPaper(item.id).catch((e) => setError(e.message)); setStream(""); }}><strong>{item.title}</strong><small>{item.original_filename}</small></button><button className="removePaper" title="删除论文" aria-label={`删除 ${item.title}`} onClick={() => removePaper(item.id)}>×</button></div>) : <p className="emptyLibrary">上传第一篇 PDF，开始建立您的论文库。</p>}
      {paper && <div className="outline"><strong>论文目录</strong>{units.map((unit) => <button key={unit.id} className={current?.id === unit.id ? "active" : ""} disabled={pending} aria-busy={pending} onClick={() => { if (unit.page_start) setPage(unit.page_start); act("NAVIGATE", unit.id); }}>{unit.heading}</button>)}</div>}</div>
      <div className="libraryFoot">上传的 PDF 保存在当前服务端</div>
    </aside>}
    <section className="workspace">
      <header className="readerTop"><div className="readerTitle"><button className="libraryToggle" onClick={() => setLibraryOpen((open) => !open)} aria-label={libraryOpen ? "收起论文库" : "展开论文库"} title={libraryOpen ? "收起论文库" : "展开论文库"}>{libraryOpen ? "☰" : "▤"}</button><div><span className="sectionLabel">AI DEEP READING</span><h1>{paper?.title || "选择或上传一篇论文"}</h1></div></div>{paper?.status === "parsed" && readerTab === "read" && <div className="modeSwitch" {...modeTabs.list} aria-label="阅读视图">{(["split", "pdf", "ai"] as const).map((item) => <button key={item} {...modeTabs.item(item)}>{item === "split" ? "左右分屏" : item === "pdf" ? "仅 PDF" : "仅 AI"}</button>)}</div>}</header>
      {paper?.status === "parsed" && <div className="readerSubnav" {...readerTabs.list} aria-label="精读视图"><button {...readerTabs.item("read")}>论文精读</button><button {...readerTabs.item("xray", openXRay)}>Paper X-Ray</button><button {...readerTabs.item("storyboard")}>Figure Storyboard</button></div>}
      {error && <div className="alert" role="alert">{error}</div>}
      {parseStage && paper && <div className="parseNotice" role="status">{parseStage}</div>}
      {paper?.warning && <div className="alert" role="status">{paper.warning}</div>}
      {needsReparse && <div className="alert" role="status">这篇 PDF 的标题或章节可能识别错误，会影响 AI 讲解与文献对比。<button type="button" onClick={reparse} disabled={pending} aria-busy={pending} className="quietButton">重新识别当前 PDF</button></div>}
      {!paper ? <div className="welcome"><div className="welcomeMark" aria-hidden="true"><span>PDF</span><b>→</b><span>AI</span></div><h2>{parseStage || "让阅读从原文开始"}</h2><p>上传本地 PDF 后，左侧查看原文，右侧按科学问题和证据链逐步精读。上传不会自动调用 AI。</p><label className="bigUpload" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, welcomeUploadRef.current)}>选择 PDF 文件<input ref={welcomeUploadRef} type="file" accept="application/pdf,.pdf" onChange={upload} disabled={pending || !ready} hidden /></label></div> : paper.status !== "parsed" ?
      <div className="metadataPaper"><span className="sectionLabel">{paper.status === "metadata_only" ? "METADATA ONLY" : paper.status === "failed" ? "PDF PARSE FAILED" : "PDF PARSING"}</span><h2>{paper.title}</h2><p>{paper.year || ""} {paper.journal || ""}</p><div className="miniNotice">{paper.status === "metadata_only" ? "当前只有检索元数据和摘要，尚未分析全文。上传 PDF 后才可使用逐页精读、Figure 和证据分析。" : paper.status === "failed" ? "PDF 未能成功解析。请核对文件后重新上传；解析成功前不会开放全文分析。" : "PDF 正在解析。完成前不会开放全文精读、Figure 或证据分析。"}</div>{paper.abstract && <p className="metadataAbstract">{paper.abstract}</p>}{["metadata_only", "failed"].includes(paper.status) && <label className="bigUpload" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, attachUploadRef.current)}>{paper.status === "failed" ? "重新上传 PDF" : "上传这篇论文的 PDF"}<input ref={attachUploadRef} type="file" accept=".pdf,application/pdf" onChange={attach} disabled={pending} hidden /></label>}</div> : readerTab === "xray" ?
      <XRayPanel xray={xray} units={units} pending={pending} onJump={jumpTo} /> : readerTab === "storyboard" ?
      <FigureStoryboard paperId={paper.id} units={units} messages={paper.messages || []} onJump={jumpTo} /> :
      <div className="split">
        {mode !== "ai" && <div className="pdfColumn" data-pdf-mode={mode} style={{ "--pdf-w": `${pdfWidth}%` } as CSSProperties}><PdfPane paperId={paper.id} page={page} totalPages={paper.page_count} onPageChange={setPage} />{mode === "split" && <div className="dragHandle" title="拖动调整宽度" role="separator" aria-orientation="vertical" tabIndex={0} aria-valuenow={Math.round(pdfWidth)} aria-valuemin={30} aria-valuemax={70} aria-label="调整 PDF 与 AI 面板宽度" onKeyDown={(e) => { let next = pdfWidth; if (e.key === "ArrowLeft") next = Math.max(30, pdfWidth - 2); else if (e.key === "ArrowRight") next = Math.min(70, pdfWidth + 2); else if (e.key === "Home") next = 30; else if (e.key === "End") next = 70; else return; e.preventDefault(); setPdfWidth(next); window.localStorage.setItem("reader-pdf-width", String(next)); }} onPointerDown={(e) => { const target = e.currentTarget; target.setPointerCapture(e.pointerId); const startX = e.clientX; const start = pdfWidth; const total = target.parentElement?.parentElement?.clientWidth || 1000; target.onpointermove = (move) => { const width = Math.max(30, Math.min(70, start + (move.clientX - startX) / total * 100)); setPdfWidth(width); window.localStorage.setItem("reader-pdf-width", String(width)); }; target.onpointerup = () => { target.onpointermove = null; target.onpointerup = null; }; }} />}</div>}
        {mode !== "pdf" && <div className="chatColumn"><div className="readingStatus"><span>当前阅读位置</span><strong>{activeHeading || current?.heading || "尚未开始"}</strong><small>阅读进度已保存；提问不会推进。</small>{figureIndex > 0 && <div className="figureProgress">Figure {figureIndex} / {figures.length}<div>{figures.map((unit, i) => <span key={unit.id} className={i < figureIndex ? "filled" : ""}>●</span>)}</div></div>}</div>
          <div className="messages" ref={messagesRef} onScroll={(event) => { const box = event.currentTarget; followLatest.current = box.scrollHeight - box.scrollTop - box.clientHeight < 100; }}>{!paper.messages?.length && !stream && <div className="chatIntro">点击“开始精读”，先读题目与摘要。之后每次只推进一个阅读单元。</div>}{paper.messages?.map((item) => <div key={item.id} className={`bubble ${item.role}`}><span>{item.role === "user" ? "你" : "精读助手"}{item.role === "assistant" && units.find((unit) => unit.id === item.reading_unit_id)?.kind === "FIGURE" && <em className={item.visual_verified ? "verified" : "unverified"}>{item.visual_verified ? "视觉解析已完成" : "基于正文和图注，图像未核验"}</em>}</span>{item.role === "assistant" && units.find((unit) => unit.id === item.reading_unit_id)?.kind === "RECAP" ? <SummaryCards content={item.content} /> : <div className="markdownBody"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown></div>}</div>)}{stream && <div className="bubble assistant"><span>精读助手 · 正在生成</span><div className="markdownBody">{stream}</div></div>}</div>
          <div className="chatControls"><div className="quickActions"><button disabled={pending || (!next && !!current)} aria-busy={pending} onClick={() => act(current ? "NEXT" : "START")}>{nextLabel}</button>{current?.kind === "FIGURE" && <button disabled={pending} aria-busy={pending} onClick={() => act("FIGURE")}>解释这张图</button>}<button disabled={pending} aria-busy={pending} onClick={() => act("WHY_DESIGN")}>为什么这样设计？</button><button disabled={pending} aria-busy={pending} onClick={() => act("EVIDENCE")}>这个结果说明什么？</button></div><form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) act("QUESTION", draft.trim()); }}><textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="提出你的科研问题…" aria-label="提出你的科研问题" rows={2} disabled={pending} /><button type="submit" disabled={pending || !draft.trim()} aria-busy={pending}>{pending ? "生成中" : "发送 ↗"}</button></form></div>
        </div>}
      </div>}
    </section>
  </main></div>;
}
