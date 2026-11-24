"use client";

import PageMain from "@/components/PageMain";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type CSSProperties, type KeyboardEvent, type ReactNode, ChangeEvent, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { API, ApiError, apiJson } from "@/lib/api";
import { notifyPaperLibraryChange, readPaperLibrary, subscribeToPaperLibrary, type PaperSummary } from "@/lib/paper-library";
import JobProgress from "@/components/jobs/JobProgress";
import ThinkingTrail from "@/components/reader/ThinkingTrail";
import type { MindMapPayload } from "@/components/mindmap/MindMapPanel";
import type { PaperExperimentsPayload } from "@/components/experiment-map/PaperExperimentsPanel";
import { submitJob, watchJob, type JobProgress as JobProgressData } from "@/lib/jobs";
import { setPaperInSynthesis, updateWorkspace, useWorkspace } from "@/lib/workspace";
import { tabGroup } from "@/lib/tabs";
import { readTabDraft, useTabDraft, writeTabDraft } from "@/lib/tab-draft";
import { deferredPanel } from "@/components/deferred-panel";
import "./enhancements.css";

const PdfPane = deferredPanel(() => import("@/components/PdfPane"), " PDF", "pdfPaneLoading");
const MindMapPanel = deferredPanel(() => import("@/components/mindmap/MindMapPanel"), "思维导图");
const PaperExperimentsPanel = deferredPanel(() => import("@/components/experiment-map/PaperExperimentsPanel"), "实验导图");
const ReadingMarkdown = lazy(() => import("@/components/reader/ReadingMarkdown").catch(() => ({
  default: ({ content }: { content: string }) => <span className="streamText">{content}</span>,
})));
type Unit = { id: string; position: number; kind: string; heading: string; page_start: number | null; actual_pdf_page?: number | null; caption?: string | null; evidence_snippet?: string | null };
type Message = { id: string; role: string; content: string; reading_unit_id: string | null; visual_verified?: boolean; turn_id?: string | null };
type SavedSummary = { prepared_demo?: boolean; question: string; stages: { key: string; label: string; summary: string; unit_ids: string[] }[]; limitations: string[] };
type Paper = { id: string; title: string; original_filename: string; current_unit_id: string | null; status: string; abstract?: string | null; year?: number | null; journal?: string | null; units?: Unit[]; messages?: Message[]; saved_summary?: SavedSummary; warning?: string; page_count?: number; file_available?: boolean; file_version?: string | null; content_revision?: string | null; source_matches?: boolean };
type ReaderTab = "summary" | "read" | "mindmap" | "experiments";
type ParseSubmission = Pick<Paper, "id" | "status" | "warning" | "content_revision">;
type Action = "START" | "NEXT" | "NAVIGATE" | "FIGURE" | "WHY_DESIGN" | "EVIDENCE" | "QUESTION";
type Mode = "split" | "pdf" | "ai";
type PaperDeletion = { status: "pending" | "deleted" } | { status: "failed"; message: string };
const compactQuery = "(max-width: 760px)";
const compactModes = ["pdf", "ai"] as const;
const desktopModes = ["split", "pdf", "ai"] as const;
// The server sends a heartbeat every 15 seconds, including during model thinking.
const chatIdleTimeoutMs = 35000;

async function readSavedMap<T>(paperId: string, view: "mindmap" | "experiments", signal: AbortSignal): Promise<T | null> {
  try {
    return await apiJson<T>(`/api/papers/${encodeURIComponent(paperId)}/saved-map/${view}`, { signal, cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

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
const readingPositionKey = (paperId: string) => `read-position:${paperId}`;
const lastPaperKey = "read-last-paper";
const pendingUploadKey = "read-pending-upload";
const turnDraftKey = (paperId: string, action: Action) => `read-turn:${paperId}:${action}`;
type ChatTurn = { id: string; message?: string };
type ReadingPosition = { fileVersion: string; page: number };
type PendingUpload = { requestId: string; name: string; size: number; modified: number };
const chatActions: Action[] = ["START", "NEXT", "NAVIGATE", "FIGURE", "WHY_DESIGN", "EVIDENCE", "QUESTION"];

function validPdfPage(paper: Paper | null, page: number) {
  return !!paper?.file_available && Number.isInteger(page) && page > 0 && page <= (paper.page_count || 0);
}

function startingPdfPage(paper: Paper, requested: number, sourceFile: string | null) {
  if (validPdfPage(paper, requested) && (!sourceFile || sourceFile === paper.file_version)) return requested;
  const saved = readTabDraft<ReadingPosition>(readingPositionKey(paper.id));
  if (paper.file_version && saved?.fileVersion === paper.file_version && validPdfPage(paper, saved.page)) return saved.page;
  return paper.units?.find((unit) => unit.id === paper.current_unit_id)?.page_start || 1;
}

function reconcileChatTurns(paper: Paper) {
  const saved = new Set(paper.messages?.filter((item) => item.role === "assistant").map((item) => item.turn_id));
  for (const action of chatActions) {
    const key = turnDraftKey(paper.id, action);
    const turn = readTabDraft<ChatTurn>(key);
    if (!turn || !saved.has(turn.id)) continue;
    const draftKey = questionDraftKey(paper.id);
    if (action === "QUESTION" && readTabDraft<string>(draftKey)?.trim() === turn.message) writeTabDraft(draftKey, null);
    writeTabDraft(key, null);
  }
}

async function checkUploadReceipt(requestId: string, signal: AbortSignal) {
  let notFound = false;
  for (const delay of [0, 500, 1000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    signal.throwIfAborted();
    try {
      return await apiJson<{ id: string }>(`/api/papers/uploads/${encodeURIComponent(requestId)}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), cache: "no-store",
      });
    } catch (e) {
      if (signal.aborted) throw e;
      notFound = e instanceof ApiError && e.status === 404;
      if (e instanceof ApiError && e.status < 500 && e.status !== 429 && !notFound) throw e;
    }
  }
  throw new Error(notFound ? "暂未找到这次上传。可以再次确认，或重新选择同一文件。"
    : "暂时无法确认上传结果，可以稍后重试确认。");
}

async function confirmPaperDeletion(id: string) {
  const path = `/api/papers/${encodeURIComponent(id)}`;
  try {
    const result = await apiJson<{ deleted: boolean }>(path, {
      method: "DELETE", signal: AbortSignal.timeout(10000),
    });
    if (result?.deleted) return;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) return;
      if (error.status < 500 && error.status !== 408) throw error;
    }
  }
  // The server may have committed before the DELETE response was lost.
  try {
    await apiJson(path, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return;
  }
  throw new Error("暂时无法确认删除结果。可以稍后核对或重试。");
}

export default function ReadPage() {
  const searchParams = useSearchParams();
  const paperParam = searchParams.get("paper");
  const linkPage = searchParams.get("page");
  const requestedPage = Number(linkPage);
  const sourceFile = searchParams.get("source_file");
  const citation = sourceFile !== null || searchParams.get("citation") === "1";
  const { workspace, workspaceError, refresh } = useWorkspace();
  const [lastPaper] = useTabDraft<string>(lastPaperKey);
  const [pendingUpload] = useTabDraft<PendingUpload>(pendingUploadKey);
  const [deletions, setDeletions] = useState<Record<string, PaperDeletion>>({});
  const [deletedTitle, setDeletedTitle] = useState("");
  const fallbackId = lastPaper ?? workspace?.core_paper_id ?? null;
  const selectedId = paperParam ?? (fallbackId && deletions[fallbackId]?.status !== "deleted" ? fallbackId : null);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState(false);
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [paperToRefresh, setPaperToRefresh] = useState<{ id: string; removed: boolean } | null>(null);
  const [record, setPaper] = useState<Paper | null>(null);
  const paper = record?.id === selectedId ? record : null;
  const sourceChanged = !!paper?.file_available && !!sourceFile && sourceFile !== paper.file_version;
  const validLinkPage = validPdfPage(paper, requestedPage);
  const invalidLinkPage = !!paper?.file_available && linkPage !== null && !validLinkPage;
  const [openAttempt, setOpenAttempt] = useState(0);
  const [paperOpenError, setPaperOpenError] = useState<{ id: string; message: string } | null>(null);
  const openError = paperOpenError?.id === selectedId ? paperOpenError.message : "";
  const openingPaper = !!selectedId && !paper && !openError;
  const [savedQuestion, setDraft] = useTabDraft<string>(paper ? questionDraftKey(paper.id) : null);
  const draft = typeof savedQuestion === "string" ? savedQuestion : "";
  const [pending, setPending] = useState(false);
  const [parseStage, setParseStage] = useState("");
  const [parseProgress, setParseProgress] = useState("");
  const [unconfirmedParse, setUnconfirmedParse] = useState<ParseSubmission | null>(null);
  const [addingToSynthesis, setAddingToSynthesis] = useState(false);
  const [settingCenter, setSettingCenter] = useState(false);
  const [centerError, setCenterError] = useState("");
  const [stream, setStream] = useState("");
  const [error, setError] = useState("");
  const compact = useSyncExternalStore(subscribeToViewport, () => window.matchMedia(compactQuery).matches, () => false);
  const [desktopMode, setDesktopMode] = useTabDraft<Mode>("read-mode-desktop");
  const [compactMode, setCompactMode] = useTabDraft<"pdf" | "ai">("read-mode-compact");
  const preferredMode = compact ? compactMode ?? (desktopMode === "ai" ? "ai" : "pdf") : desktopMode ?? "split";
  const requestedMode = searchParams.get("view");
  const defaultMode = citation && preferredMode === "ai" ? "pdf" : preferredMode;
  const mode = requestedMode === "pdf" || requestedMode === "ai" || (requestedMode === "split" && !compact)
    ? requestedMode : defaultMode;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const libraryDrawer = useRef<HTMLDialogElement>(null);
  const libraryToggle = useRef<HTMLButtonElement>(null);
  const modeSwitch = useRef<HTMLDivElement>(null);
  const focusedReaderControl = useRef<{ element: HTMLElement; region: "library" | "pane" } | null>(null);
  const [pdfWidth, setPdfWidth] = useState(38);
  const [activeHeading, setActiveHeading] = useState("");
  const [page, setPage] = useState(1);
  const [readerTab, setReaderTab] = useState<ReaderTab>("read");
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
    if (citation || requestedMode) {
      const params = new URLSearchParams(window.location.search);
      params.set("view", next);
      window.history.replaceState(null, "", `/read?${params}`);
    }
  });
  const readerTabs = tabGroup<ReaderTab>(paper?.saved_summary
    ? ["summary", "read", "mindmap", "experiments"] : ["read", "mindmap", "experiments"], readerTab, setReaderTab);
  useLayoutEffect(() => {
    const last = focusedReaderControl.current;
    const activeElement = document.activeElement;
    if (!last || (activeElement !== document.body && activeElement !== last.element)) return;
    if (last.element.isConnected && last.element.getClientRects().length) return;
    const next = last.region === "pane"
      ? modeSwitch.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') : null;
    (next ?? libraryToggle.current)?.focus({ preventScroll: true });
  }, [compact, mode, paper?.status, readerTab]);
  // 任务请求的 in-flight 令牌。pending 与同页其它请求共用，不能拿来判重；
  // abort 会顺带取消服务端任务，切论文时旧结果不会串到新论文上。
  const mindmapAbort = useRef<AbortController | null>(null);
  const experimentsAbort = useRef<AbortController | null>(null);
  const libraryRequest = useRef<AbortController | null>(null);
  const deleteRequests = useRef(new Set<string>());
  const paperRequest = useRef(0);
  const activePaper = useRef<string | null>(null);
  const active = useRef(false);
  const chatRequest = useRef<AbortController | null>(null);
  const uploadAttempt = useRef<AbortController | null>(null);
  const parseRequest = useRef<AbortController | null>(null);
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
    libraryRequest.current?.abort();
    const controller = new AbortController();
    libraryRequest.current = controller;
    setLibraryError(false);
    try {
      const items = await readPaperLibrary(controller.signal);
      if (controller.signal.aborted) return;
      setPapers(items);
      setLibraryReady(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLibraryError(true);
      throw error;
    } finally {
      if (libraryRequest.current === controller) libraryRequest.current = null;
    }
  }, []);
  const loadPaper = useCallback(async (id: string, opening = false, signal?: AbortSignal) => {
    if (id !== activePaper.current) return;
    const request = ++paperRequest.current;
    let data: Paper;
    try {
      data = await apiJson<Paper>(`/api/papers/${encodeURIComponent(id)}`, { signal, cache: "no-store" });
    } catch (error) {
      if (request !== paperRequest.current) return;
      throw error;
    }
    if (request !== paperRequest.current || signal?.aborted) return;
    reconcileChatTurns(data);
    followLatest.current = true;
    setPaper(data);
    if (opening) {
      const params = new URLSearchParams(window.location.search);
      setPage(startingPdfPage(data, Number(params.get("page")), params.get("source_file")));
      if (data.saved_summary?.prepared_demo && !["page", "source_file", "citation", "view"].some((key) => params.has(key))) {
        setReaderTab("summary");
      }
      if (readTabDraft<string>(lastPaperKey) !== id) writeTabDraft(lastPaperKey, id);
    }
    return data;
  }, []);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("reader-pdf-width"));
    if (saved >= 30 && saved <= 70) setPdfWidth(saved);
    loadList().catch(() => {});
    return () => libraryRequest.current?.abort();
  }, [loadList]);
  useEffect(() => subscribeToPaperLibrary(({ paperId, removed }) => {
    void loadList().catch(() => {});
    if (removed) void refresh(true).catch(() => {});
    if (activePaper.current === paperId) setPaperToRefresh({ id: paperId, removed });
  }), [loadList, refresh]);
  useEffect(() => {
    if (pending || !paperToRefresh) return;
    const { id, removed } = paperToRefresh;
    if (id !== selectedId) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    void loadPaper(id, false, signal).catch((error) => {
      if (removed && !controller.signal.aborted && activePaper.current === id &&
          error instanceof ApiError && error.status === 404) {
        setPaper(null);
        setPaperOpenError({ id, message: "这篇论文已从论文库移除。" });
      }
    }).finally(() => {
      if (!controller.signal.aborted) setPaperToRefresh((current) => current === paperToRefresh ? null : current);
    });
    return () => controller.abort();
  }, [pending, selectedId, paperToRefresh, loadPaper]);

  useEffect(() => {
    activePaper.current = selectedId;
    setPaperToRefresh(null);
    stopChat();
    if (parseRequest.current) {
      parseRequest.current.abort();
      parseRequest.current = null;
      setPending(false);
      setParseStage("");
    }
    setUnconfirmedParse(null);
    abortReaderJobs();
    setPaper(null);
    setReaderTab("read"); setMindmap(null); setExperiments(null);
    setThinking(""); setActiveHeading(""); setError(""); setCenterError(""); setParseProgress("");
    setPaperOpenError(null);
    if (!selectedId) return;
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(10000);
    const signal = AbortSignal.any([controller.signal, deadline]);
    loadPaper(selectedId, true, signal)
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (!paperParam && e instanceof ApiError && e.status === 404 && readTabDraft<string>(lastPaperKey) === selectedId) {
          writeTabDraft(lastPaperKey, null);
          void refresh(true).catch(() => {});
        }
        const message = deadline.aborted ? "读取论文超时，请重试。"
          : e instanceof ApiError ? e.message : "暂时无法读取论文，请重试。";
        setPaperOpenError({ id: selectedId, message });
      });
    return () => { ++paperRequest.current; controller.abort(); };
  }, [selectedId, openAttempt, loadPaper]);

  useEffect(() => {
    if (selectedId && showPdf) PdfPane.preload();
  }, [selectedId, showPdf]);

  useEffect(() => {
    if (paper?.file_available) setPage(startingPdfPage(paper, requestedPage, sourceFile));
  }, [paper?.id, paper?.file_available, paper?.file_version, requestedPage, sourceFile, validLinkPage]);

  // 组件卸载（跳到别的页面）时取消后台任务，避免服务端为一个没人看的任务继续花钱。
  useEffect(() => {
    active.current = true;
    const saved = readTabDraft<PendingUpload>(pendingUploadKey);
    if (saved?.requestId) void runUpload(saved);
    return () => {
      active.current = false;
      chatRequest.current?.abort();
      parseRequest.current?.abort();
      parseRequest.current = null;
      uploadAttempt.current?.abort();
      uploadAttempt.current = null;
      abortReaderJobs();
    };
  }, []);

  // A paper can finish parsing after the initial upload wait, or while the
  // reader is closed. Resume lightweight polling when it is opened again.
  useEffect(() => {
    if (!paper || pending || !parseStages[paper.status]) return;
    const id = paper.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () => !controller.signal.aborted && activePaper.current === id;
    const poll = async () => {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
        const progress = await apiJson<Pick<Paper, "status">>(`/api/papers/${id}/status`, { signal, cache: "no-store" });
        if (!isCurrent()) return;
        if (progress.status === "parsed" || progress.status === "failed") {
          await loadPaper(id, false, signal);
          if (!isCurrent()) return;
          setParseProgress("");
          notifyPaperLibraryChange(id);
          void loadList().catch(() => {});
          return;
        }
        setParseProgress(parseStages[progress.status] || "");
      } catch (error) {
        if (!isCurrent()) return;
        if (error instanceof ApiError && error.status === 404) {
          setParseProgress("");
          setError("这篇论文已不在论文库。可以打开其他论文。");
          setPaper(null);
          void loadList().catch(() => {});
          return;
        }
        setParseProgress("暂时无法读取论文状态，正在重试…");
      }
      if (isCurrent()) timer = setTimeout(poll, 3000);
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
    event.target.value = "";
    if (!file || pending || uploadAttempt.current) return;
    const saved = readTabDraft<PendingUpload>(pendingUploadKey);
    const intent = saved?.name === file.name && saved.size === file.size && saved.modified === file.lastModified ? saved : {
      requestId: crypto.randomUUID(), name: file.name, size: file.size, modified: file.lastModified,
    };
    closeLibraryDrawer();
    await runUpload(intent, file);
  }

  async function runUpload(intent: PendingUpload, file?: File) {
    if (uploadAttempt.current) return;
    const controller = new AbortController();
    uploadAttempt.current = controller;
    const current = () => active.current && !controller.signal.aborted && uploadAttempt.current === controller;
    const openingPaperId = new URLSearchParams(window.location.search).get("paper");
    writeTabDraft(pendingUploadKey, intent);
    setPending(true); setError(""); setParseStage(file ? "正在上传 PDF…" : "正在确认 PDF 是否入库…");
    try {
      let result: { id: string };
      if (file) {
        const body = new FormData();
        body.append("file", file);
        try {
          result = await apiJson<{ id: string }>(`/api/papers?deferred=true&request_id=${encodeURIComponent(intent.requestId)}`, { method: "POST", body });
        } catch (e) {
          if (!current()) return;
          if (e instanceof ApiError && e.status < 500 && e.status !== 429) {
            if (e.status !== 409) writeTabDraft(pendingUploadKey, null);
            throw e;
          }
          setParseStage("正在确认 PDF 是否入库…");
          result = await checkUploadReceipt(intent.requestId, controller.signal);
        }
      } else {
        result = await checkUploadReceipt(intent.requestId, controller.signal);
      }
      if (!current()) return;
      writeTabDraft(pendingUploadKey, null);
      notifyPaperLibraryChange(result.id);
      if (new URLSearchParams(window.location.search).get("paper") === openingPaperId) selectPaper(result.id);
      void loadList().catch(() => {});
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "暂时无法确认上传结果");
    } finally {
      if (uploadAttempt.current === controller) {
        uploadAttempt.current = null;
        setPending(false); setParseStage("");
      }
    }
  }

  async function confirmParseRequest(previous: ParseSubmission, action?: "attach" | "reparse", body?: FormData) {
    if (parseRequest.current) return;
    const { id } = previous;
    const controller = new AbortController();
    parseRequest.current = controller;
    const isCurrent = () => active.current && activePaper.current === id && !controller.signal.aborted;
    setPending(true); setError("");
    setUnconfirmedParse(null);
    setParseStage(action === "attach" ? "正在上传全文 PDF…" : action === "reparse" ? "正在提交重新识别…" : "正在核对解析状态…");
    try {
      let status: string | undefined;
      if (action) {
        try {
          // Leave the submission in flight when the reader switches papers.
          const result = await apiJson<Pick<Paper, "status">>(`/api/papers/${encodeURIComponent(id)}/${action}`, {
            method: "POST", body, signal: AbortSignal.timeout(body ? 15 * 60 * 1000 : 20000),
          });
          status = result?.status;
        } catch (error) {
          if (error instanceof ApiError && error.status < 500 && error.status !== 408 && error.status !== 409) throw error;
        }
      }
      if (!isCurrent()) return;
      if (status) {
        const acceptedStatus = status;
        setPaper((record) => record?.id === id ? { ...record, status: acceptedStatus, warning: undefined } : record);
      } else {
        setParseStage("正在核对解析状态…");
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
        const data = await loadPaper(id, false, signal).catch(() => undefined);
        if (!isCurrent()) return;
        const newFailure = data?.warning?.startsWith("重新解析失败") && data.warning !== previous.warning;
        if (!data || (!parseStages[data.status] && data.status === previous.status &&
            data.content_revision === previous.content_revision && !newFailure)) {
          setUnconfirmedParse(previous);
          return;
        }
        status = data.status;
        if (!parseStages[status]) void loadList().catch(() => {});
      }
      abortReaderJobs();
      setReaderTab("read"); setMindmap(null); setExperiments(null);
      setParseProgress(parseStages[status] || "");
      notifyPaperLibraryChange(id);
    } catch (error) {
      if (isCurrent()) setError(error instanceof ApiError ? error.message : "暂时无法提交 PDF 解析请求。");
    } finally {
      if (parseRequest.current === controller) {
        parseRequest.current = null;
        setPending(false); setParseStage("");
      }
    }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !paper || pending) return;
    const body = new FormData();
    body.append("file", file);
    try { await confirmParseRequest(paper, "attach", body); }
    finally { event.target.value = ""; }
  }

  async function reparse() {
    if (!paper || pending || !window.confirm("重新识别会保留原 PDF、旧精读记录和综合结果，但会重置当前阅读位置。旧记录与新章节的关联将解除，旧综合结果需要重新核对。继续吗？")) return;
    await confirmParseRequest(paper, "reparse");
  }

  /** 章节骨架由后端确定性生成，AI 只补关键点。 */
  async function loadMindmap() {
    if (!paper || paper.status !== "parsed") return;
    if (mindmap || mindmapAbort.current) return;
    const controller = new AbortController();
    mindmapAbort.current = controller;
    setMindmapBusy(true); setError(""); setMindmapProgress(null);
    try {
      const saved = await readSavedMap<MindMapPayload>(paper.id, "mindmap", controller.signal);
      if (controller.signal.aborted) return;
      if (saved) { setMindmap(saved); return; }
      setMindmapStage("正在构建章节骨架"); setMindmapStartedAt(Date.now());
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
    setExperimentsProgress(null);
    try {
      const saved = await readSavedMap<PaperExperimentsPayload>(paper.id, "experiments", controller.signal);
      if (controller.signal.aborted) return;
      if (saved) { setExperiments(saved); return; }
      setExperimentsStage("正在读取方法与结果单元"); setExperimentsStartedAt(Date.now());
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
    jumpToPdfPage(unit?.page_start ?? undefined);
  }

  function jumpToPdfPage(next?: number) {
    if (next) changePdfPage(next);
    if (compact) setCompactMode("pdf");
    else setDesktopMode("split");
    setReaderTab("read");
  }

  async function act(action: Action, message?: string) {
    if (!paper || paper.status !== "parsed" || pending || chatRequest.current) return;
    const controller = new AbortController();
    const network = new AbortController();
    const networkSignal = AbortSignal.any([controller.signal, network.signal]);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    function resetIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timedOut = true;
        network.abort();
      }, chatIdleTimeoutMs);
    }
    chatRequest.current = controller;
    setChatStartedAt(Date.now());
    setPending(true); setError(""); setStream(""); setThinking(""); setActiveHeading(""); followLatest.current = true;
    let completed = false;
    let turn: ChatTurn | undefined;
    try {
      const key = turnDraftKey(paper.id, action);
      const previous = readTabDraft<ChatTurn>(key);
      turn = previous && previous.message === message ? previous : { id: crypto.randomUUID(), message };
      writeTabDraft(key, turn);
      resetIdleTimer();
      const res = await fetch(`${API}/api/papers/${paper.id}/chat`, {
        method: "POST", credentials: "include", signal: networkSignal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, message, unit_id: action === "NAVIGATE" ? message : undefined, turn_id: turn.id }),
      });
      resetIdleTimer();
      if (!res.ok) { const data = await res.json(); throw new Error(data.detail || "请求失败"); }
      if (!res.body) throw new Error("浏览器未收到流式响应");
      const reader = res.body.getReader(); const decoder = new TextDecoder();
      let buffer = ""; let answer = "";
      while (!completed) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) return;
        if (done) break;
        if (value.byteLength) resetIdleTimer();
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
            break;
          }
        }
      }
      if (!completed) throw new Error("流式回复未正常结束");
      clearTimeout(idleTimer);
      network.abort();
      await loadPaper(paper.id, false, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
      if (controller.signal.aborted) return;
      setStream("");
      void loadList().catch(() => {});
    } catch (e) {
      clearTimeout(idleTimer);
      network.abort();
      if (!controller.signal.aborted) {
        // The response can disconnect after the server commits both messages.
        // Match the saved turn before suggesting a retry or clearing a draft.
        if (turn && !completed) {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
          const detail = await loadPaper(paper.id, false, signal).catch(() => undefined);
          if (controller.signal.aborted) return;
          completed = !!detail?.messages?.some((item) => item.role === "assistant" && item.turn_id === turn?.id);
          if (completed) {
            setStream("");
            void loadList().catch(() => {});
            return;
          }
        }
        if (!completed) { setStream(""); setThinking(""); }
        setError(completed ? "回复已保存，暂时无法刷新论文，请重新打开查看。"
          : timedOut ? "连接长时间无响应，请重试当前操作。"
          : e instanceof TypeError ? "连接中断，请重试当前操作。"
          : e instanceof Error ? e.message : "精读失败");
        controller.abort();
      }
    } finally {
      clearTimeout(idleTimer);
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
    if (id === selectedId && !paper) {
      setPaperOpenError(null);
      setOpenAttempt((attempt) => attempt + 1);
      return;
    }
    window.history.pushState(null, "", `/read?paper=${encodeURIComponent(id)}`);
  }

  function changePdfPage(next: number) {
    if (!paper || paper.id !== activePaper.current) return;
    setPage(next);
    if (paper.file_version && validPdfPage(paper, next)) {
      writeTabDraft<ReadingPosition>(readingPositionKey(paper.id), { fileVersion: paper.file_version, page: next });
    }
    const params = new URLSearchParams(window.location.search);
    params.set("paper", paper.id);
    params.set("page", String(next));
    if (params.has("source_file")) params.set("citation", "1");
    params.delete("source_file");
    window.history.replaceState(null, "", `/read?${params}`);
  }

  async function queueForSynthesis() {
    if (!paper || addingToSynthesis) return;
    setAddingToSynthesis(true); setError("");
    try { await setPaperInSynthesis(paper.id, true, (workspace ?? await refresh()).query); }
    catch (e) { setError(e instanceof Error ? e.message : "无法加入待综合列表"); }
    finally { setAddingToSynthesis(false); }
  }

  async function setAsCenter() {
    if (!paper || !workspace || settingCenter) return;
    const id = paper.id;
    setSettingCenter(true); setCenterError("");
    try {
      await updateWorkspace({ core_paper_id: id }, workspace.query);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await refresh(true).catch(() => {});
      if (activePaper.current === id) setCenterError(e instanceof Error ? e.message : "暂时无法设置中心论文");
    } finally {
      setSettingCenter(false);
    }
  }

  async function removePaper({ id, title }: PaperSummary) {
    if (deleteRequests.current.has(id) ||
        !window.confirm("删除这篇论文、聊天记录及引用它的研究结果？此操作无法恢复。")) return;
    deleteRequests.current.add(id);
    setDeletedTitle("");
    setDeletions((current) => ({ ...current, [id]: { status: "pending" } }));
    try {
      await confirmPaperDeletion(id);
      if (active.current) {
        setDeletions((current) => ({ ...current, [id]: { status: "deleted" } }));
        setDeletedTitle(title);
        const currentParam = new URLSearchParams(window.location.search).get("paper");
        if (currentParam === id || (!currentParam && activePaper.current === id)) {
          ++paperRequest.current;
          setPaper(null);
          window.history.replaceState(null, "", "/read");
        }
        void loadList().catch(() => {});
      }
      writeTabDraft(questionDraftKey(id), null);
      writeTabDraft(readingPositionKey(id), null);
      if (readTabDraft<string>(lastPaperKey) === id) writeTabDraft(lastPaperKey, null);
      for (const action of chatActions) writeTabDraft(turnDraftKey(id, action), null);
      notifyPaperLibraryChange(id, true);
      void refresh(true).catch(() => {});
    } catch (error) {
      if (active.current) setDeletions((current) => ({
        ...current, [id]: { status: "failed", message: error instanceof Error ? error.message : "暂时无法删除论文。" },
      }));
    } finally {
      deleteRequests.current.delete(id);
    }
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
  const readerLoading = openingPaper || (!paperParam && !workspace && !workspaceError);
  const libraryOpen = compact ? drawerOpen : sidebarOpen;
  const libraryTerm = libraryQuery.trim().toLocaleLowerCase();
  const visiblePapers = papers.filter((item) => deletions[item.id]?.status !== "deleted" && (!libraryTerm
    || [item.title, item.original_filename].some((value) => value?.toLocaleLowerCase().includes(libraryTerm))));
  const libraryContents = <>
    <div className="libraryHeading">
      <strong id="reader-library-title">论文库</strong>
      <label className="uploadBtn" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, libraryUploadRef.current)}>
        ＋ 上传 PDF<input ref={libraryUploadRef} type="file" accept="application/pdf,.pdf" onChange={upload} disabled={pending} hidden />
      </label>
      {compact && <button className="quietButton libraryClose" type="button" aria-label="关闭论文库" onClick={closeLibraryDrawer}>关闭论文库</button>}
    </div>
    {papers.length > 0 && <div className="libraryFilter">
      <input type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)}
        placeholder="搜索题名或文件名" aria-label="搜索论文库" />
    </div>}
    {paper && workspace && <div className="libraryFilter">
      {workspace.core_paper_id === paper.id ? <span className="tabDraftNote" role="status">当前为中心论文</span>
        : <button className="quietButton" type="button" onClick={() => void setAsCenter()} disabled={settingCenter} aria-busy={settingCenter}>
          {settingCenter ? "正在保存…" : "设为中心论文"}
        </button>}
      {centerError && <p className="pdfError" role="alert">{centerError}</p>}
    </div>}
    <div className="libraryList">
      {deletedTitle && <p className="libraryFilter" role="status">已从论文库移除：{deletedTitle}</p>}
      {libraryError && <div className="libraryFilter">
        <p className="pdfError" role="alert">暂时无法读取论文库。</p>
        <button type="button" className="quietButton" onClick={() => void loadList().catch(() => {})}>重试读取论文库</button>
      </div>}
      {!libraryReady ? (!libraryError && <p className="emptyLibrary" role="status">正在读取论文库…</p>)
        : visiblePapers.length ? visiblePapers.map((item) => {
          const deletion = deletions[item.id];
          return <div key={item.id}>
            <div className="paperRow">
              <button className={`paperItem ${selectedId === item.id ? "selected" : ""}`} disabled={!!parseStage}
                aria-current={selectedId === item.id ? "true" : undefined} onClick={() => selectPaper(item.id)}>
                <strong>{item.title}</strong><small>{item.original_filename}</small>
              </button>
              <button className="removePaper" title="删除论文" aria-label={`删除 ${item.title}`}
                disabled={deletion?.status === "pending"} onClick={() => void removePaper(item)}>×</button>
            </div>
            {deletion?.status === "pending" && <p className="libraryFilter" role="status">正在确认删除结果…</p>}
            {deletion?.status === "failed" && <p className="libraryFilter pdfError" role="alert">{deletion.message}</p>}
          </div>;
        })
        : <p className="emptyLibrary" role="status">{libraryTerm ? "没有匹配的论文。试试换个关键词。" : "上传第一篇 PDF，开始建立您的论文库。"}</p>}
      {paper && !libraryTerm && <div className="outline">
        <strong>当前论文目录</strong>
        {units.map((unit) => <button key={unit.id} className={current?.id === unit.id ? "active" : ""} disabled={pending}
          onClick={() => { closeLibraryDrawer(); if (unit.page_start) changePdfPage(unit.page_start); act("NAVIGATE", unit.id); }}>{unit.heading}</button>)}
      </div>}
    </div>
    <div className="libraryFoot">上传的 PDF 保存在当前服务端</div>
  </>;
  return <PageMain route="/read" className={`reader ${compact ? "readerCompact" : ""} ${!libraryOpen ? "libraryClosed" : ""}`}
    onFocusCapture={({ target }) => {
      if (!(target instanceof HTMLElement)) return;
      const region = target.closest("#reader-library") ? "library"
        : target.closest(".modeSwitch, #reader-pane-pdf, #reader-pane-ai") ? "pane" : null;
      focusedReaderControl.current = region ? { element: target, region } : null;
    }}>
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
            <h1 title={paper?.title}>{paper?.title || (selectedId ? "深度精读" : readerLoading ? "正在打开精读" : "选择或上传一篇论文")}</h1>
          </div>
        </div>
        {paper?.status === "parsed" && readerTab === "read" && <div ref={modeSwitch} className="modeSwitch" {...modeTabs.list} aria-label="阅读视图">
          {modes.map((item) => <button key={item} type="button" {...modeTabs.item(item)} id={`reader-mode-${item}`}
            aria-controls={item === "split" ? "reader-pane-pdf reader-pane-ai" : `reader-pane-${item}`}>
            {item === "split" ? "左右分屏" : item === "pdf" ? (compact ? "原文 PDF" : "仅 PDF") : (compact ? "AI 讲解" : "仅 AI")}
          </button>)}
        </div>}
      </header>
      {paper?.status === "parsed" && <div className="readerSubnav"><div className="readerViewTabs" {...readerTabs.list} aria-label="精读视图">{paper.saved_summary && <button {...readerTabs.item("summary")}>全文解读</button>}<button {...readerTabs.item("read")}>论文精读</button><button {...readerTabs.item("mindmap", openMindmap)}>行文导图</button><button {...readerTabs.item("experiments", openExperiments)}>实验导图</button></div>{workspace?.selected_paper_ids.includes(paper.id) ? <Link className="quietButton readerSynthesis" href="/synthesis">{compact ? "查看待综合 ↗" : "已选入综合 · 查看 ↗"}</Link> : <button className="quietButton readerSynthesis" type="button" onClick={queueForSynthesis} disabled={addingToSynthesis} aria-busy={addingToSynthesis}>{addingToSynthesis ? "正在加入…" : "加入待综合"}</button>}</div>}
      {error && <div className="alert" role="alert">{error}{pendingUpload && !pending && <button className="quietButton" onClick={() => void runUpload(pendingUpload)}>重试确认上传</button>}</div>}
      {unconfirmedParse && <div className="alert" role="alert">暂时无法确认 PDF 解析请求是否已受理。
        <button type="button" className="quietButton" disabled={pending} onClick={() => void confirmParseRequest(unconfirmedParse)}>核对解析状态</button>
      </div>}
      <JobProgress startedAt={chatStartedAt} hint=""
        title={stream ? "正在生成精读回复" : thinking ? "正在分析原文" : "正在等待精读回复"}
        onCancel={stopChat} />
      {(parseStage || parseProgress) && paper && <div className="parseNotice" role="status">{parseStage || parseProgress}</div>}
      {paper?.warning && <div className="alert" role="status">{paper.warning}</div>}
      {sourceChanged && <div className="alert" role="status">旧引用的页码与当前 PDF 无法确认对应。已打开当前 PDF，请重新核对原文。 <button type="button" className="quietButton" onClick={() => changePdfPage(page)}>按当前 PDF 继续</button></div>}
      {!sourceChanged && invalidLinkPage && <div className="alert" role="status">链接中的页码不在这份 PDF 内。已打开当前阅读位置。 <button type="button" className="quietButton" onClick={() => changePdfPage(page)}>继续阅读</button></div>}
      {needsReplacement && <div className="alert" role="status">{paper.source_matches === false ? "当前 PDF 与保存的阅读内容无法确认对应，已暂停全文分析。可重新识别当前文件，或上传原文件。" : "当前 PDF 文件无法读取或重新识别失败。重新上传后会保留旧精读记录和综合结果，请核对其与原文的对应关系。"}{paper.source_matches === false && <button type="button" onClick={reparse} disabled={pending} className="quietButton">重新识别当前 PDF</button>}<label className="quietButton" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, attachUploadRef.current)}>重新上传 PDF<input ref={attachUploadRef} type="file" accept=".pdf,application/pdf" onChange={attach} disabled={pending} hidden /></label></div>}
      {needsReparse && <div className="alert" role="status">这篇 PDF 的标题或章节可能识别错误，会影响 AI 讲解与文献对比。<button type="button" onClick={reparse} disabled={pending} aria-busy={pending} className="quietButton">重新识别当前 PDF</button></div>}
      {selectedId && openError && !paper ? <div className="welcome">
        <h2>暂时无法打开论文</h2>
        <p role="alert">{openError}</p>
        <button type="button" className="quietButton" onClick={() => selectPaper(selectedId)}>重试打开论文</button>
      </div> : readerLoading && !parseStage ? <div className="welcome" role="status" aria-busy="true"><h2>正在打开论文…</h2></div> : !paper ? <div className="welcome"><div className="welcomeMark" aria-hidden="true"><span>PDF</span><b>→</b><span>AI</span></div><h2>{parseStage || "让阅读从原文开始"}</h2><p>上传 PDF 后，可查看原文并按阅读单元逐步精读。上传不会自动调用 AI。</p><label className="bigUpload" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, welcomeUploadRef.current)}>选择 PDF 文件<input ref={welcomeUploadRef} type="file" accept="application/pdf,.pdf" onChange={upload} disabled={pending} hidden /></label></div> : paper.status !== "parsed" ?
      <div className="metadataPaper"><span className="sectionLabel">{paper.status === "metadata_only" ? "METADATA ONLY" : paper.status === "failed" ? "PDF PARSE FAILED" : "PDF PARSING"}</span><h2>{paper.title}</h2><p>{paper.year || ""} {paper.journal || ""}</p><div className="miniNotice">{paper.status === "metadata_only" ? "当前只有检索元数据和摘要，尚未分析全文。上传 PDF 后才可使用逐页精读、Figure 和证据分析。" : paper.status === "failed" ? "PDF 未能成功解析。请核对文件后重新上传；解析成功前不会开放全文分析。" : "PDF 正在解析。完成前不会开放全文精读、Figure 或证据分析。"}</div>{paper.abstract && <p className="metadataAbstract">{paper.abstract}</p>}{["metadata_only", "failed"].includes(paper.status) && <label className="bigUpload" tabIndex={0} role="button" onKeyDown={(e) => openUpload(e, attachUploadRef.current)}>{paper.status === "failed" ? "重新上传 PDF" : "上传这篇论文的 PDF"}<input ref={attachUploadRef} type="file" accept=".pdf,application/pdf" onChange={attach} disabled={pending} hidden /></label>}</div> :
      <>
      {readerTab === "summary" && paper.saved_summary && <article className="sectionBox savedReading">
        <h2>全文解读</h2>
        <p>{paper.saved_summary.question}</p>
        {paper.saved_summary.stages.map((stage) => <section key={stage.key}>
          <h3>{stage.label}</h3>
          <p>{stage.summary}</p>
          {!!stage.unit_ids.length && <button type="button" className="quietButton" onClick={() => jumpTo(stage.unit_ids[0])}>对照原文 ↗</button>}
        </section>)}
        {!!paper.saved_summary.limitations.length && <section><h3>局限与证据边界</h3>
          <ul>{paper.saved_summary.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </section>}
      </article>}
      {readerTab === "mindmap" && <>
        {mindmapBusy && <JobProgress title="正在生成行文导图" stageLabel={mindmapStage} progress={mindmapProgress} startedAt={mindmapStartedAt} hint="可在这篇论文内切换视图；离开论文会停止任务" onCancel={() => mindmapAbort.current?.abort()} />}
        <MindMapPanel mindmap={mindmap} pending={mindmapBusy} onJump={jumpTo} />
      </>}
      {readerTab === "experiments" && <>
        {experimentsBusy && <JobProgress title="正在提取论文实验链" stageLabel={experimentsStage} progress={experimentsProgress} startedAt={experimentsStartedAt} hint="可在这篇论文内切换视图；离开论文会停止任务" onCancel={() => experimentsAbort.current?.abort()} />}
        <PaperExperimentsPanel payload={experiments} pending={experimentsBusy} onJump={jumpTo} onPage={jumpToPdfPage} />
      </>}
      <div className="split" key={paper.id} hidden={readerTab !== "read"}>
        <RetainedPane active={showPdf} compact={compact} panel="pdf" className="pdfColumn" pdfMode={mode} style={{ "--pdf-w": `${pdfWidth}%` } as CSSProperties}><PdfPane paperId={paper.id} fileVersion={paper.file_version} page={page} totalPages={paper.page_count} onPageChange={changePdfPage} />{mode === "split" && <div className="dragHandle" title="拖动调整宽度" role="separator" aria-orientation="vertical" tabIndex={0} aria-valuenow={Math.round(pdfWidth)} aria-valuemin={30} aria-valuemax={70} aria-label="调整 PDF 与 AI 面板宽度" onKeyDown={(e) => { let next = pdfWidth; if (e.key === "ArrowLeft") next = Math.max(30, pdfWidth - 2); else if (e.key === "ArrowRight") next = Math.min(70, pdfWidth + 2); else if (e.key === "Home") next = 30; else if (e.key === "End") next = 70; else return; e.preventDefault(); setPdfWidth(next); window.localStorage.setItem("reader-pdf-width", String(next)); }} onPointerDown={(e) => { const target = e.currentTarget; target.setPointerCapture(e.pointerId); const startX = e.clientX; const start = pdfWidth; const total = target.parentElement?.parentElement?.clientWidth || 1000; target.onpointermove = (move) => { const width = Math.max(30, Math.min(70, start + (move.clientX - startX) / total * 100)); setPdfWidth(width); window.localStorage.setItem("reader-pdf-width", String(width)); }; target.onpointerup = () => { target.onpointermove = null; target.onpointerup = null; }; }} />}</RetainedPane>
        <RetainedPane active={showChat} compact={compact} panel="ai" className="chatColumn"><div className="readingStatus"><span>当前阅读位置</span><strong>{activeHeading || current?.heading || "尚未开始"}</strong><small>阅读进度已保存；提问不会推进。</small>{figureIndex > 0 && <div className="figureProgress">Figure {figureIndex} / {figures.length}<div>{figures.map((unit, i) => <span key={unit.id} className={i < figureIndex ? "filled" : ""}>●</span>)}</div></div>}</div>
          <div className="messages" ref={messagesRef} onScroll={(event) => { const box = event.currentTarget; followLatest.current = box.scrollHeight - box.scrollTop - box.clientHeight < 100; }}>{!paper.messages?.length && !stream && !thinking && <div className="chatIntro">点击“开始精读”，先读题目与摘要。之后每次只推进一个阅读单元。</div>}{paper.messages?.map((item) => <div key={item.id} className={`bubble ${item.role}`}><span>{item.role === "user" ? "你" : "精读助手"}{item.role === "assistant" && units.find((unit) => unit.id === item.reading_unit_id)?.kind === "FIGURE" && <em className={item.visual_verified ? "verified" : "unverified"}>{item.visual_verified ? "视觉解析已完成" : "基于正文和图注，图像未核验"}</em>}</span>{item.role === "assistant" && units.find((unit) => unit.id === item.reading_unit_id)?.kind === "RECAP" ? <SummaryCards content={item.content} /> : <div className="markdownBody"><Markdown content={item.content} /></div>}</div>)}<ThinkingTrail text={thinking} active={pending && !!thinking.trim()} />{stream && <div className="bubble assistant"><span>{chatStartedAt === null ? "精读助手 · 回复已保存" : "精读助手 · 正在生成"}</span><div className="markdownBody streamText">{stream}</div></div>}</div>
          <div className="chatControls"><div className="quickActions"><button disabled={pending || (!next && !!current)} aria-busy={pending} onClick={() => act(current ? "NEXT" : "START")}>{nextLabel}</button>{current?.kind === "FIGURE" && <button disabled={pending} aria-busy={pending} onClick={() => act("FIGURE")}>解释这张图</button>}<button disabled={pending} aria-busy={pending} onClick={() => act("WHY_DESIGN")}>为什么这样设计？</button><button disabled={pending} aria-busy={pending} onClick={() => act("EVIDENCE")}>这个结果说明什么？</button></div><form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) act("QUESTION", draft.trim()); }}><textarea value={draft} onChange={(e) => setDraft(e.target.value || null)} placeholder="提出你的科研问题…" aria-label="提出你的科研问题" rows={2} disabled={pending} /><button type="submit" disabled={pending || !draft.trim()} aria-busy={pending}>{pending ? "生成中" : "发送 ↗"}</button></form>{draft && <small className="tabDraftNote">提问草稿 · 当前标签页</small>}</div>
        </RetainedPane>
      </div></>}
    </section>
  </PageMain>;
}
