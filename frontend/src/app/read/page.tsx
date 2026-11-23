"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type CSSProperties, type KeyboardEvent, type ReactNode, ChangeEvent, lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { API, apiJson } from "@/lib/api";
import JobProgress from "@/components/jobs/JobProgress";
import ThinkingTrail from "@/components/reader/ThinkingTrail";
import type { MindMapPayload } from "@/components/mindmap/MindMapPanel";
import type { PaperExperimentsPayload } from "@/components/experiment-map/PaperExperimentsPanel";
import { submitJob, watchJob, type JobProgress as JobProgressData } from "@/lib/jobs";
import { addPaperToSynthesis, updateWorkspace, useWorkspace } from "@/lib/workspace";
import { tabGroup } from "@/lib/tabs";
import { useTabDraft, writeTabDraft } from "@/lib/tab-draft";
import "./enhancements.css";

const PdfPane = dynamic(() => import("@/components/PdfPane"), {
  ssr: false,
  loading: () => <p className="pdfPaneLoading" role="status">正在打开 PDF…</p>,
});
const MindMapPanel = dynamic(() => import("@/components/mindmap/MindMapPanel"));
const PaperExperimentsPanel = dynamic(() => import("@/components/experiment-map/PaperExperimentsPanel"));
const ReadingMarkdown = lazy(() => import("@/components/reader/ReadingMarkdown"));
type Unit = { id: string; position: number; kind: string; heading: string; page_start: number | null; actual_pdf_page?: number | null; caption?: string | null; evidence_snippet?: string | null };
type Message = { id: string; role: string; content: string; reading_unit_id: string | null; visual_verified?: boolean };
type Paper = { id: string; title: string; original_filename: string; current_unit_id: string | null; status: string; abstract?: string | null; year?: number | null; journal?: string | null; units?: Unit[]; messages?: Message[]; warning?: string; page_count?: number; file_available?: boolean; source_matches?: boolean };
type Action = "START" | "NEXT" | "NAVIGATE" | "FIGURE" | "WHY_DESIGN" | "EVIDENCE" | "QUESTION";
type Mode = "split" | "pdf" | "ai";
const compactQuery = "(max-width: 760px)";
const compactModes = ["pdf", "ai"] as const;
const desktopModes = ["split", "pdf", "ai"] as const;

function subscribeToViewport(listener: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function RetainedPane({ active, compact, panel, className, pdfMode, style, children }: {
  active: boolean; compact: boolean; panel: "pdf" | "ai"; className: string;
  pdfMode?: Mode; style?: CSSProperties; children: ReactNode;
}) {
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  return <div className={className} id={`reader-pane-${panel}`} hidden={!active}
    role={compact ? "tabpanel" : undefined} aria-labelledby={compact ? `reader-mode-${panel}` : undefined}
    data-pdf-mode={pdfMode} style={style}>{(active || visited) && children}</div>;
}
const parseStages: Record<string, string> = {
  uploaded: "正在读取 PDF…", reading: "正在提取每页文字…", structure: "正在识别论文章节…",
  figures: "正在定位主文 Figure 和 Table…", manifest: "正在建立阅读目录…", images: "正在提取页面图像…",
};

function Markdown({ content }: { content: string }) {
  return <Suspense fallback={<span className="streamText">{content}</span>}>
    <ReadingMarkdown content={content} />
  </Suspense>;
}

function SummaryCards({ content }: { content: string }) {
  const parts = [...content.matchAll(/【([^】]+)】([\s\S]*?)(?=【[^】]+】|$)/g)];
  if (parts.length < 3) return <Markdown content={content} />;
  return <div className="summaryGrid">{parts.map((part, index) => <article className="summaryCard" key={index}><h3>{part[1]}</h3>{part[1] === "关系图" ? <div className="relationFlow">{part[2].trim().split("\n").filter(Boolean).map((line, i) => { const nodes = line.replace(/^[-*]\s*/, "").split(/\s*(?:->|→)\s*/); return nodes.length === 2 ? <div className="relationEdge" key={i}><span>{nodes[0]}</span><b>→</b><span>{nodes[1]}</span></div> : <div key={i}>{line}</div>; })}</div> : <div><Markdown content={part[2].trim()} /></div>}</article>)}</div>;
}

const questionDraftKey = (paperId: string) => `read:${paperId}`;

export default function ReadPage() {
  const searchParams = useSearchParams();
  const paperParam = searchParams.get("paper");
  const requestedPage = Number(searchParams.get("page"));
  const { workspace, workspaceError, refresh } = useWorkspace();
  const selectedId = paperParam ?? workspace?.core_paper_id ?? null;
  const [ready, setReady] = useState(false);
  const [libraryError, setLibraryError] = useState(false);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [record, setPaper] = useState<Paper | null>(null);
  const paper = record?.id === selectedId ? record : null;
  const [openingPaper, setOpeningPaper] = useState(false);
  const [savedQuestion, setDraft] = useTabDraft<string>(paper ? questionDraftKey(paper.id) : null);
  const draft = typeof savedQuestion === "string" ? savedQuestion : "";
  const [pending, setPending] = useState(false);
  const [parseStage, setParseStage] = useState("");
  const [parseProgress, setParseProgress] = useState("");
  const [addingToSynthesis, setAddingToSynthesis] = useState(false);
  const [stream, setStream] = useState("");
  const [error, setError] = useState("");
  const compact = useSyncExternalStore(subscribeToViewport, () => window.matchMedia(compactQuery).matches, () => false);
  const [desktopMode, setDesktopMode] = useState<Mode>("split");
  const [compactMode, setCompactMode] = useState<"pdf" | "ai" | null>(null);
  const mode = compact ? compactMode ?? (desktopMode === "ai" ? "ai" : "pdf") : desktopMode;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const libraryDrawer = useRef<HTMLDialogElement>(null);
  const libraryToggle = useRef<HTMLButtonElement>(null);
  const [pdfWidth, setPdfWidth] = useState(38);
  const [activeHeading, setActiveHeading] = useState("");
  const [page, setPage] = useState(1);
  const [readerTab, setReaderTab] = useState<"read" | "mindmap" | "experiments">("read");
  const [thinking, setThinking] = useState("");
  const [chatStartedAt, setChatStartedAt] = useState<number | null>(null);
  const [mindmap, setMindmap] = useState<MindMapPayload | null>(null);
  const [mindmapBusy, setMindmapBusy] = useState(false);
  const [mindmapStage, setMindmapStage] = useState("");
  const [mindmapStartedAt, setMindmapStartedAt] = useState<number | null>(null);
  const [mindmapProgress, setMindmapProgress] = useState<JobProgressData | null>(null);
  const [experiments, setExperiments] = useState<PaperExperimentsPayload | null>(null);
  const [experimentsBusy, setExperimentsBusy] = useState(false);
  const [experimentsStage, setExperimentsStage] = useState("");
  const [experimentsStartedAt, setExperimentsStartedAt] = useState<number | null>(null);
  const [experimentsProgress, setExperimentsProgress] = useState<JobProgressData | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastPositionedChat = useRef<{ id: string; count: number } | null>(null);
  const followLatest = useRef(true);
  const showPdf = readerTab === "read" && mode !== "ai";
  const showChat = readerTab === "read" && mode !== "pdf";
  const modes = compact ? compactModes : desktopModes;
  const modeTabs = tabGroup<Mode>(modes, mode, (next) => {
    if (compact) setCompactMode(next === "ai" ? "ai" : "pdf");
    else setDesktopMode(next);
  });
  const readerTabs = tabGroup(["read", "mindmap", "experiments"] as const, readerTab, setReaderTab);
  // 任务请求的 in-flight 令牌。pending 与同页其它请求共用，不能拿来判重；
  // abort 会顺带取消服务端任务，切论文时旧结果不会串到新论文上。
  const mindmapAbort = useRef<AbortController | null>(null);
  const experimentsAbort = useRef<AbortController | null>(null);
  const paperRequest = useRef(0);
  const activePaper = useRef<string | null>(null);
  const active = useRef(false);
  const chatRequest = useRef<AbortController | null>(null);
  const libraryUploadRef = useRef<HTMLInputElement>(null);
  const welcomeUploadRef = useRef<HTMLInputElement>(null);
  const attachUploadRef = useRef<HTMLInputElement>(null);
  // 上传入口的键盘等价：<input hidden> 是 display:none，不在 tab 序，外包的 <label> 也不可聚焦（ux-spec D1）。
  function openUpload(event: KeyboardEvent<HTMLLabelElement>, input: HTMLInputElement | null) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    input?.click();
  }

  /** 离开当前论文/页面时取消后台任务：既让 UI 立刻复位，也避免服务端继续为没人看的论文烧 token。
   *  注意要在这里复位 busy：watchJob 被 abort 后，调用方的 finally 会看到 ref 已是 null 而跳过清理，
   *  不在这里复位就会留下一个永远转圈的进度卡。 */
  function abortReaderJobs() {
    mindmapAbort.current?.abort();
    mindmapAbort.current = null;
    setMindmapBusy(false); setMindmapStartedAt(null); setMindmapProgress(null); setMindmapStage("");
    experimentsAbort.current?.abort();
    experimentsAbort.current = null;
    setExperimentsBusy(false); setExperimentsStartedAt(null); setExperimentsProgress(null); setExperimentsStage("");
  }

  const loadList = useCallback(async () => {
    setLibraryError(false);
    try {
      setPapers(await apiJson<Paper[]>("/api/papers"));
      setReady(true);
    } catch (error) {
      setLibraryError(true);
      throw error;
    }
  }, []);
  const loadPaper = useCallback(async (id: string, opening = false, signal?: AbortSignal) => {
    if (id !== activePaper.current) return;
    const request = ++paperRequest.current;
    let data: Paper;
    try {
      data = await apiJson<Paper>(`/api/papers/${encodeURIComponent(id)}`, { signal });
    } catch (error) {
      if (request !== paperRequest.current) return;
      throw error;
    }
    if (request !== paperRequest.current) return;
    followLatest.current = true;
    setPaper(data);
    if (opening) {
      setPage(data.units?.find((unit) => unit.id === data.current_unit_id)?.page_start || 1);
      void updateWorkspace({core_paper_id: id}).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("reader-pdf-width"));
    if (saved >= 30 && saved <= 70) setPdfWidth(saved);
    loadList().catch(() => {});
  }, [loadList]);

  useEffect(() => {
    if (paperParam === null && selectedId) {
      const params = new URLSearchParams(window.location.search);
      params.set("paper", selectedId);
      window.history.replaceState(null, "", `/read?${params}`);
    }
  }, [paperParam, selectedId]);
  useEffect(() => {
    activePaper.current = selectedId;
    stopChat();
    abortReaderJobs();
    setPaper(null);
    setReaderTab("read"); setMindmap(null); setExperiments(null);
    setThinking(""); setActiveHeading(""); setError(""); setParseProgress("");
    setOpeningPaper(!!selectedId);
    if (!selectedId) return;
    const controller = new AbortController();
    loadPaper(selectedId, true, controller.signal)
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setOpeningPaper(false); });
    return () => { ++paperRequest.current; controller.abort(); };
  }, [selectedId, loadPaper]);

  useEffect(() => {
    if (!paper || paper.id !== selectedId || !requestedPage) return;
    if (Number.isInteger(requestedPage) && requestedPage <= (paper.page_count || 0) && requestedPage > 0) setPage(requestedPage);
  }, [selectedId, requestedPage, paper?.id, paper?.page_count]);

  // 组件卸载（跳到别的页面）时取消后台任务，避免服务端为一个没人看的任务继续花钱。
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; chatRequest.current?.abort(); abortReaderJobs(); };
  }, []);

  // A paper can finish parsing after the initial upload wait, or while the
  // reader is closed. Resume lightweight polling when it is opened again.
  useEffect(() => {
    if (!paper || pending || !parseStages[paper.status]) return;
    const id = paper.id;
    const request = paperRequest.current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`${API}/api/papers/${id}/status`, { credentials: "include", signal: controller.signal });
        if (response.ok) {
          const progress: Pick<Paper, "status" | "warning"> = await response.json();
          if (controller.signal.aborted || request !== paperRequest.current) return;
          if (progress.status === "parsed" || progress.status === "failed") {
            await loadPaper(id);
            setParseProgress("");
            await loadList();
            return;
          }
          setParseProgress(parseStages[progress.status] || "");
        }
      } catch {
        // A temporary network error should not stop future status checks.
      }
      if (!controller.signal.aborted && request === paperRequest.current) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [paper?.id, paper?.status, pending, loadList, loadPaper]);

  useEffect(() => {
    if (!compact) setDrawerOpen(false);
  }, [compact]);

  useEffect(() => {
    if (!showChat || !paper) return;
    const container = messagesRef.current;
    const count = paper.messages?.length ?? 0;
    if (!container || (lastPositionedChat.current?.id === paper.id && lastPositionedChat.current.count === count)) return;
    lastPositionedChat.current = { id: paper.id, count };
    const assistants = container?.querySelectorAll<HTMLElement>(".bubble.assistant");
    const latest = assistants?.[assistants.length - 1];
    if (latest) {
      container.scrollTop += latest.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
      followLatest.current = false;
    }
  }, [showChat, paper?.id, paper?.messages?.length]);
  useEffect(() => {
    const container = messagesRef.current;
    // 思考轨迹也在对话流里滚动，所以它增长时同样跟随到底部。
    if (showChat && container && (stream || thinking) && followLatest.current) container.scrollTop = container.scrollHeight;
  }, [showChat, stream, thinking]);

  function toggleLibrary() {
    if (!compact) { setSidebarOpen((current) => !current); return; }
    const drawer = libraryDrawer.current;
    if (!drawer) return;
    if (drawer.open) drawer.close();
    else {
      drawer.showModal();
      drawer.querySelector<HTMLButtonElement>(".libraryClose")?.focus();
      setDrawerOpen(true);
    }
  }

  function closeLibraryDrawer() {
    libraryDrawer.current?.close();
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !ready) return;
    closeLibraryDrawer();
    setPending(true); setError(""); setParseStage("正在上传 PDF…");
    const origin = activePaper.current;
    try {
      const body = new FormData(); body.append("file", file);
      const result = await apiJson<{ id: string }>("/api/papers?deferred=true", { method: "POST", body });
      if (active.current && activePaper.current === origin) selectPaper(result.id);
      if (active.current) void loadList().catch(() => {});
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
        const status = await fetch(`${API}/api/papers/${paper.id}/status`, { credentials: "include" });
        if (!status.ok) throw new Error("论文读取失败，请稍后重试");
        const latest: Pick<Paper, "status" | "warning"> = await status.json();
        if (latest.status === "failed") throw new Error("PDF 解析失败，请重试");
        if (latest.status === "parsed") { await loadPaper(paper.id); await loadList(); return; }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("解析仍在进行，请稍后从论文库打开");
    } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); }
    finally { setPending(false); setParseStage(""); event.target.value = ""; }
  }

  async function reparse() {
    if (!paper || pending || !window.confirm("重新识别会保留原 PDF、旧精读记录和综合结果，但会重置当前阅读位置。旧记录与新章节的关联将解除，旧综合结果需要重新核对。继续吗？")) return;
    const id = paper.id;
    setPending(true); setError(""); setParseStage("正在用新版规则重新解析 PDF…");
    try {
      const response = await fetch(`${API}/api/papers/${id}/reparse`, { method: "POST", credentials: "include" });
      if (!response.ok) { const data = await response.json(); throw new Error(data.detail || "重新解析失败"); }
      for (let attempt = 0; attempt < 240; attempt++) {
        const status = await fetch(`${API}/api/papers/${id}/status`, { credentials: "include" });
        if (!status.ok) throw new Error("无法读取解析进度");
        const latest: Pick<Paper, "status" | "warning"> = await status.json();
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

  /** 章节骨架由后端确定性生成，AI 只补关键点。 */
  async function loadMindmap() {
    if (!paper || paper.status !== "parsed") return;
    if (mindmap || mindmapAbort.current) return;
    const controller = new AbortController();
    mindmapAbort.current = controller;
    setMindmapBusy(true); setError(""); setMindmapStage("正在构建章节骨架"); setMindmapStartedAt(Date.now()); setMindmapProgress(null);
    try {
      const job = await submitJob("mindmap", { paper_id: paper.id });
      const snapshot = await watchJob(job.id, {
        onStage: (_stage, label) => setMindmapStage(label),
        onProgress: (progress) => setMindmapProgress(progress),
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (snapshot.status !== "done") throw new Error(snapshot.error?.message || "思维导图生成未完成，请重试");
      const artifact = snapshot.result as { payload?: MindMapPayload } | null;
      if (artifact?.payload) setMindmap(artifact.payload);
      else throw new Error("思维导图没有返回可用结果");
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "思维导图生成失败");
    } finally {
      if (mindmapAbort.current === controller) {
        mindmapAbort.current = null; setMindmapBusy(false); setMindmapStartedAt(null); setMindmapProgress(null); setMindmapStage("");
      }
    }
  }

  function openMindmap() {
    setReaderTab("mindmap");
    void loadMindmap();
  }

  /** 实验导图 = 论文"实际做过"的实验链；与设计页"实验设计图"不同，源数据是方法与结果单元。 */
  async function loadExperiments() {
    if (!paper || paper.status !== "parsed") return;
    if (experiments || experimentsAbort.current) return;
    const controller = new AbortController();
    experimentsAbort.current = controller;
    setExperimentsBusy(true); setError("");
    setExperimentsStage("正在读取方法与结果单元"); setExperimentsStartedAt(Date.now()); setExperimentsProgress(null);
    try {
      const job = await submitJob("paper_experiments", { paper_id: paper.id });
      const snapshot = await watchJob(job.id, {
        onStage: (_stage, label) => setExperimentsStage(label),
        onProgress: (progress) => setExperimentsProgress(progress),
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (snapshot.status !== "done") throw new Error(snapshot.error?.message || "实验导图生成未完成，请重试");
      const artifact = snapshot.result as { payload?: PaperExperimentsPayload } | null;
      if (artifact?.payload) setExperiments(artifact.payload);
      else throw new Error("实验导图没有返回可用结果");
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "实验导图生成失败");
    } finally {
      if (experimentsAbort.current === controller) {
        experimentsAbort.current = null; setExperimentsBusy(false);
        setExperimentsStartedAt(null); setExperimentsProgress(null); setExperimentsStage("");
      }
    }
  }

  function openExperiments() {
    setReaderTab("experiments");
    void loadExperiments();
  }

  function jumpTo(unitId: string) {
    const unit = paper?.units?.find((item) => item.id === unitId);
    if (unit?.page_start) changePdfPage(unit.page_start);
    if (compact) setCompactMode("pdf");
    else setDesktopMode("split");
    setReaderTab("read");
  }

  async function act(action: Action, message?: string) {
    if (!paper || !ready || pending || chatRequest.current) return;
    const controller = new AbortController();
    chatRequest.current = controller;
    setChatStartedAt(Date.now());
    setPending(true); setError(""); setStream(""); setThinking(""); setActiveHeading(""); followLatest.current = true;
    let completed = false;
    try {
      const res = await fetch(`${API}/api/papers/${paper.id}/chat`, {
        method: "POST", credentials: "include", signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, message, unit_id: action === "NAVIGATE" ? message : undefined }),
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.detail || "请求失败"); }
      if (!res.body) throw new Error("浏览器未收到流式响应");
      const reader = res.body.getReader(); const decoder = new TextDecoder();
      let buffer = ""; let answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) return;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n"); buffer = events.pop() || "";
        for (const raw of events) {
          const line = raw.split("\n").find((part) => part.startsWith("data: "));
          if (!line) continue;
          const data = JSON.parse(line.slice(6));
          // thinking：模型出正文前的推理增量。只放内存用于「思考轨迹」，不进消息历史。
          if (data.type === "thinking") { setThinking((previous) => previous + (data.content ?? "")); continue; }
          if (data.type === "delta") { answer += data.content; setStream(answer); }
          if (data.type === "reset") { answer = ""; setStream(""); setThinking(""); }
          if (data.type === "selected") { if (data.page) changePdfPage(data.page); setActiveHeading(data.heading || ""); }
          if (data.type === "error") throw new Error(data.message);
          if (data.type === "done") {
            completed = true;
            setChatStartedAt(null);
            if (action === "QUESTION") setDraft(null);
          }
        }
      }
      if (!completed) throw new Error("流式回复未正常结束");
      await loadPaper(paper.id);
      if (controller.signal.aborted) return;
      setStream("");
      await loadList().catch(() => {});
    } catch (e) {
      if (!controller.signal.aborted) {
        if (!completed) { setStream(""); setThinking(""); }
        setError(completed ? "回复已保存，暂时无法刷新论文，请重新打开查看。"
          : e instanceof Error ? e.message : "精读失败");
        controller.abort();
      }
    } finally {
      if (chatRequest.current === controller) {
        chatRequest.current = null;
        setChatStartedAt(null); setPending(false); setActiveHeading("");
      }
    }
  }

  function stopChat() {
    if (!chatRequest.current) return;
    chatRequest.current.abort();
    chatRequest.current = null;
    setChatStartedAt(null); setPending(false); setStream(""); setThinking(""); setActiveHeading("");
  }

  function selectPaper(id: string) {
    closeLibraryDrawer();
    if (id === paperParam && paper) return;
    if (id === selectedId && openingPaper) return;
    if (id === selectedId && !paper && !openingPaper) {
      setError(""); setOpeningPaper(true);
      const request = loadPaper(id, true);
      const generation = paperRequest.current;
      request.catch((e) => { if (generation === paperRequest.current) setError(e.message); })
        .finally(() => { if (generation === paperRequest.current) setOpeningPaper(false); });
      return;
    }
    window.history.pushState(null, "", `/read?paper=${encodeURIComponent(id)}`);
  }

  function changePdfPage(next: number) {
    if (!paper || paper.id !== activePaper.current) return;
    setPage(next);
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(next));
    window.history.replaceState(null, "", `/read?${params}`);
  }

  async function queueForSynthesis() {
    if (!paper || addingToSynthesis) return;
    setAddingToSynthesis(true); setError("");
    try { await addPaperToSynthesis(paper.id); }
    catch (e) { setError(e instanceof Error ? e.message : "无法加入待综合列表"); }
    finally { setAddingToSynthesis(false); }
  }

  async function removePaper(id: string) {
    if (!window.confirm("删除这篇论文及其聊天记录？此操作无法恢复。")) return;
    setError("");
    const response = await fetch(`${API}/api/papers/${id}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) { setError("删除论文失败，请重试"); return; }
    writeTabDraft(questionDraftKey(id), null);
    await refresh().catch(() => {});
    if (active.current && activePaper.current === id) {
      setPaper(null);
      window.history.replaceState(null, "", "/read");
    }
    await loadList().catch(() => {});
  }

  const current = paper?.units?.find((unit) => unit.id === paper.current_unit_id);
  const units = paper?.units || [];
  // 「解析成功但一个阅读单元都没有」是后端能给出的真实信号，比按标题字面量判断可靠：
  // 原先写死的 "hhs public access" 只是某一篇种子论文的标题，换一篇空解析的论文就不提示了。
  const needsReparse = !!paper && paper.status === "parsed"
    && (units.length === 0 || !!paper.warning?.includes("未可靠识别论文章节"));
  const needsReplacement = !!paper && paper.status === "parsed" &&
    (paper.file_available === false || !!paper.warning?.startsWith("重新解析失败"));
  const next = units[current ? current.position + 1 : 0];
  const figures = units.filter((unit) => unit.kind === "FIGURE");
  const figureIndex = current?.kind === "FIGURE" ? figures.findIndex((unit) => unit.id === current.id) + 1 : 0;
  const nextLabel = !current ? "开始精读 · 题目与摘要" : next?.kind === "FIGURE" ? `进入 ${next.heading}` : next?.kind === "RECAP" ? "全文总结" : next ? next.kind === "DISCUSSION" ? "进入 Discussion" : "下一部分" : "已读完";
  const readerLoading = openingPaper || (!!selectedId && !paper && !error) || (!paperParam && !workspace && !workspaceError);
  const libraryOpen = compact ? drawerOpen : sidebarOpen;
  const libraryTerm = libraryQuery.trim().toLocaleLowerCase();
  const visiblePapers = papers.filter((item) => !libraryTerm
    || [item.title, item.original_filename].some((value) => value?.toLocaleLowerCase().includes(libraryTerm)));
  const libraryContents = <>
    <div className="libraryHeading">
      <strong id="reader-library-title">论文库</strong>
      <label className="uploadBtn" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, libraryUploadRef.current)}>
        ＋ 上传 PDF<input ref={libraryUploadRef} type="file" accept="application/pdf,.pdf" onChange={upload} disabled={pending || !ready} hidden />
      </label>
      {compact && <button className="quietButton libraryClose" type="button" aria-label="关闭论文库" onClick={closeLibraryDrawer}>关闭论文库</button>}
    </div>
    {papers.length > 0 && <div className="libraryFilter">
      <input type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)}
        placeholder="搜索题名或文件名" aria-label="搜索论文库" />
    </div>}
    <div className="libraryList">
      {libraryError && <button className="quietButton" onClick={() => void loadList().catch(() => {})}>重试读取论文库</button>}
      {!ready ? (!libraryError && <p className="emptyLibrary" role="status">正在读取论文库…</p>)
        : visiblePapers.length ? visiblePapers.map((item) => <div className="paperRow" key={item.id}>
          <button className={`paperItem ${selectedId === item.id ? "selected" : ""}`} disabled={!!parseStage}
            aria-current={selectedId === item.id ? "true" : undefined} onClick={() => selectPaper(item.id)}>
            <strong>{item.title}</strong><small>{item.original_filename}</small>
          </button>
          <button className="removePaper" title="删除论文" aria-label={`删除 ${item.title}`} onClick={() => removePaper(item.id)}>×</button>
        </div>)
        : <p className="emptyLibrary" role="status">{libraryTerm ? "没有匹配的论文。试试换个关键词。" : "上传第一篇 PDF，开始建立您的论文库。"}</p>}
      {paper && !libraryTerm && <div className="outline">
        <strong>当前论文目录</strong>
        {units.map((unit) => <button key={unit.id} className={current?.id === unit.id ? "active" : ""} disabled={pending}
          onClick={() => { closeLibraryDrawer(); if (unit.page_start) changePdfPage(unit.page_start); act("NAVIGATE", unit.id); }}>{unit.heading}</button>)}
      </div>}
    </div>
    <div className="libraryFoot">上传的 PDF 保存在当前服务端</div>
  </>;
  return <main id="main" className={`reader ${compact ? "readerCompact" : ""} ${!libraryOpen ? "libraryClosed" : ""}`}>
    {compact ? <dialog id="reader-library" ref={libraryDrawer} className="libraryDrawer" aria-labelledby="reader-library-title"
      onClose={() => { setDrawerOpen(false); libraryToggle.current?.focus({ preventScroll: true }); }}
      onClick={(event) => { if (event.target === event.currentTarget) closeLibraryDrawer(); }}>
      <div className="library">{libraryContents}</div>
    </dialog> : sidebarOpen && <aside id="reader-library" className="library" aria-labelledby="reader-library-title">{libraryContents}</aside>}
    <section className="workspace">
      <header className="readerTop">
        <div className="readerTitle">
          <button type="button" className="libraryToggle" ref={libraryToggle} onClick={toggleLibrary}
            aria-expanded={libraryOpen} aria-controls={compact || sidebarOpen ? "reader-library" : undefined} aria-haspopup={compact ? "dialog" : undefined}
            aria-label={libraryOpen ? "收起论文库" : "展开论文库"}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            <span className="libraryToggleText">论文库</span>
          </button>
          <div>
            {!compact && <span className="sectionLabel">AI DEEP READING</span>}
            <h1 title={paper?.title}>{paper?.title || (readerLoading ? "正在打开精读" : "选择或上传一篇论文")}</h1>
          </div>
        </div>
        {paper?.status === "parsed" && readerTab === "read" && <div className="modeSwitch" {...modeTabs.list} aria-label="阅读视图">
          {modes.map((item) => <button key={item} type="button" {...modeTabs.item(item)} id={`reader-mode-${item}`}
            aria-controls={item === "split" ? "reader-pane-pdf reader-pane-ai" : `reader-pane-${item}`}>
            {item === "split" ? "左右分屏" : item === "pdf" ? (compact ? "原文 PDF" : "仅 PDF") : (compact ? "AI 讲解" : "仅 AI")}
          </button>)}
        </div>}
      </header>
      {paper?.status === "parsed" && <div className="readerSubnav"><div className="readerViewTabs" {...readerTabs.list} aria-label="精读视图"><button {...readerTabs.item("read")}>论文精读</button><button {...readerTabs.item("mindmap", openMindmap)}>行文导图</button><button {...readerTabs.item("experiments", openExperiments)}>实验导图</button></div>{workspace?.selected_paper_ids.includes(paper.id) ? <Link className="quietButton readerSynthesis" href="/synthesis">{compact ? "查看待综合 ↗" : "已选入综合 · 查看 ↗"}</Link> : <button className="quietButton readerSynthesis" type="button" onClick={queueForSynthesis} disabled={addingToSynthesis} aria-busy={addingToSynthesis}>{addingToSynthesis ? "正在加入…" : "加入待综合"}</button>}</div>}
      {error && <div className="alert" role="alert">{error}{selectedId && !paper && !openingPaper && <button className="quietButton" onClick={() => selectPaper(selectedId)}>重试打开论文</button>}</div>}
      <JobProgress startedAt={chatStartedAt} hint=""
        title={stream ? "正在生成精读回复" : thinking ? "正在分析原文" : "正在等待精读回复"}
        onCancel={stopChat} />
      {(parseStage || parseProgress) && paper && <div className="parseNotice" role="status">{parseStage || parseProgress}</div>}
      {paper?.warning && <div className="alert" role="status">{paper.warning}</div>}
      {needsReplacement && <div className="alert" role="status">{paper.source_matches === false ? "当前 PDF 与保存的阅读内容无法确认对应，已暂停全文分析。可重新识别当前文件，或上传原文件。" : "当前 PDF 文件无法读取或重新识别失败。重新上传后会保留旧精读记录和综合结果，请核对其与原文的对应关系。"}{paper.source_matches === false && <button type="button" onClick={reparse} disabled={pending} className="quietButton">重新识别当前 PDF</button>}<label className="quietButton" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, attachUploadRef.current)}>重新上传 PDF<input ref={attachUploadRef} type="file" accept=".pdf,application/pdf" onChange={attach} disabled={pending} hidden /></label></div>}
      {needsReparse && <div className="alert" role="status">这篇 PDF 的标题或章节可能识别错误，会影响 AI 讲解与文献对比。<button type="button" onClick={reparse} disabled={pending} aria-busy={pending} className="quietButton">重新识别当前 PDF</button></div>}
      {readerLoading && !parseStage ? <div className="welcome" role="status" aria-busy="true"><h2>正在打开论文…</h2></div> : !paper ? <div className="welcome"><div className="welcomeMark" aria-hidden="true"><span>PDF</span><b>→</b><span>AI</span></div><h2>{parseStage || (openingPaper ? "正在打开论文…" : "让阅读从原文开始")}</h2><p>上传 PDF 后，可查看原文并按阅读单元逐步精读。上传不会自动调用 AI。</p><label className="bigUpload" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, welcomeUploadRef.current)}>选择 PDF 文件<input ref={welcomeUploadRef} type="file" accept="application/pdf,.pdf" onChange={upload} disabled={pending || !ready} hidden /></label></div> : paper.status !== "parsed" ?
      <div className="metadataPaper"><span className="sectionLabel">{paper.status === "metadata_only" ? "METADATA ONLY" : paper.status === "failed" ? "PDF PARSE FAILED" : "PDF PARSING"}</span><h2>{paper.title}</h2><p>{paper.year || ""} {paper.journal || ""}</p><div className="miniNotice">{paper.status === "metadata_only" ? "当前只有检索元数据和摘要，尚未分析全文。上传 PDF 后才可使用逐页精读、Figure 和证据分析。" : paper.status === "failed" ? "PDF 未能成功解析。请核对文件后重新上传；解析成功前不会开放全文分析。" : "PDF 正在解析。完成前不会开放全文精读、Figure 或证据分析。"}</div>{paper.abstract && <p className="metadataAbstract">{paper.abstract}</p>}{["metadata_only", "failed"].includes(paper.status) && <label className="bigUpload" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, attachUploadRef.current)}>{paper.status === "failed" ? "重新上传 PDF" : "上传这篇论文的 PDF"}<input ref={attachUploadRef} type="file" accept=".pdf,application/pdf" onChange={attach} disabled={pending} hidden /></label>}</div> :
      <>
      {readerTab === "mindmap" && <>
        {mindmapBusy && <JobProgress title="正在生成行文导图" stageLabel={mindmapStage} progress={mindmapProgress} startedAt={mindmapStartedAt} hint="可在这篇论文内切换视图；离开论文会停止任务" onCancel={() => mindmapAbort.current?.abort()} />}
        <MindMapPanel mindmap={mindmap} pending={mindmapBusy} onJump={jumpTo} />
      </>}
      {readerTab === "experiments" && <>
        {experimentsBusy && <JobProgress title="正在提取论文实验链" stageLabel={experimentsStage} progress={experimentsProgress} startedAt={experimentsStartedAt} hint="可在这篇论文内切换视图；离开论文会停止任务" onCancel={() => experimentsAbort.current?.abort()} />}
        <PaperExperimentsPanel payload={experiments} pending={experimentsBusy} onJump={jumpTo} />
      </>}
      <div className="split" key={paper.id} hidden={readerTab !== "read"}>
        <RetainedPane active={showPdf} compact={compact} panel="pdf" className="pdfColumn" pdfMode={mode} style={{ "--pdf-w": `${pdfWidth}%` } as CSSProperties}><PdfPane paperId={paper.id} page={page} totalPages={paper.page_count} onPageChange={changePdfPage} />{mode === "split" && <div className="dragHandle" title="拖动调整宽度" role="separator" aria-orientation="vertical" tabIndex={0} aria-valuenow={Math.round(pdfWidth)} aria-valuemin={30} aria-valuemax={70} aria-label="调整 PDF 与 AI 面板宽度" onKeyDown={(e) => { let next = pdfWidth; if (e.key === "ArrowLeft") next = Math.max(30, pdfWidth - 2); else if (e.key === "ArrowRight") next = Math.min(70, pdfWidth + 2); else if (e.key === "Home") next = 30; else if (e.key === "End") next = 70; else return; e.preventDefault(); setPdfWidth(next); window.localStorage.setItem("reader-pdf-width", String(next)); }} onPointerDown={(e) => { const target = e.currentTarget; target.setPointerCapture(e.pointerId); const startX = e.clientX; const start = pdfWidth; const total = target.parentElement?.parentElement?.clientWidth || 1000; target.onpointermove = (move) => { const width = Math.max(30, Math.min(70, start + (move.clientX - startX) / total * 100)); setPdfWidth(width); window.localStorage.setItem("reader-pdf-width", String(width)); }; target.onpointerup = () => { target.onpointermove = null; target.onpointerup = null; }; }} />}</RetainedPane>
        <RetainedPane active={showChat} compact={compact} panel="ai" className="chatColumn"><div className="readingStatus"><span>当前阅读位置</span><strong>{activeHeading || current?.heading || "尚未开始"}</strong><small>阅读进度已保存；提问不会推进。</small>{figureIndex > 0 && <div className="figureProgress">Figure {figureIndex} / {figures.length}<div>{figures.map((unit, i) => <span key={unit.id} className={i < figureIndex ? "filled" : ""}>●</span>)}</div></div>}</div>
          <div className="messages" ref={messagesRef} onScroll={(event) => { const box = event.currentTarget; followLatest.current = box.scrollHeight - box.scrollTop - box.clientHeight < 100; }}>{!paper.messages?.length && !stream && !thinking && <div className="chatIntro">点击“开始精读”，先读题目与摘要。之后每次只推进一个阅读单元。</div>}{paper.messages?.map((item) => <div key={item.id} className={`bubble ${item.role}`}><span>{item.role === "user" ? "你" : "精读助手"}{item.role === "assistant" && units.find((unit) => unit.id === item.reading_unit_id)?.kind === "FIGURE" && <em className={item.visual_verified ? "verified" : "unverified"}>{item.visual_verified ? "视觉解析已完成" : "基于正文和图注，图像未核验"}</em>}</span>{item.role === "assistant" && units.find((unit) => unit.id === item.reading_unit_id)?.kind === "RECAP" ? <SummaryCards content={item.content} /> : <div className="markdownBody"><Markdown content={item.content} /></div>}</div>)}<ThinkingTrail text={thinking} active={pending && !!thinking.trim()} />{stream && <div className="bubble assistant"><span>{chatStartedAt === null ? "精读助手 · 回复已保存" : "精读助手 · 正在生成"}</span><div className="markdownBody streamText">{stream}</div></div>}</div>
          <div className="chatControls"><div className="quickActions"><button disabled={pending || (!next && !!current)} aria-busy={pending} onClick={() => act(current ? "NEXT" : "START")}>{nextLabel}</button>{current?.kind === "FIGURE" && <button disabled={pending} aria-busy={pending} onClick={() => act("FIGURE")}>解释这张图</button>}<button disabled={pending} aria-busy={pending} onClick={() => act("WHY_DESIGN")}>为什么这样设计？</button><button disabled={pending} aria-busy={pending} onClick={() => act("EVIDENCE")}>这个结果说明什么？</button></div><form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) act("QUESTION", draft.trim()); }}><textarea value={draft} onChange={(e) => setDraft(e.target.value || null)} placeholder="提出你的科研问题…" aria-label="提出你的科研问题" rows={2} disabled={pending} /><button type="submit" disabled={pending || !draft.trim()} aria-busy={pending}>{pending ? "生成中" : "发送 ↗"}</button></form>{draft && <small className="tabDraftNote">提问草稿 · 当前标签页</small>}</div>
        </RetainedPane>
      </div></>}
    </section>
  </main>;
}
