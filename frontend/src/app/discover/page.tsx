"use client";

import PageMain from "@/components/PageMain";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import StepLoading from "@/components/StepLoading";
import type { LineageResponse } from "@/components/lineage/lineageLayout";
import { ApiError, apiJson, postJson } from "@/lib/api";
import { hasParsedPdf, isPdfParsing, notifyPaperLibraryChange, paperLibraryIssue, readPaperLibrary, subscribeToPaperLibrary } from "@/lib/paper-library";
import { changeWorkspaceTopic, setPaperInSynthesis, updateWorkspace, useWorkspace } from "@/lib/workspace";
import { readTabDraft, useTabDraft, writeTabDraft } from "@/lib/tab-draft";
import { tabGroup } from "@/lib/tabs";
import { deferredPanel } from "@/components/deferred-panel";
import { prepareReaderEntry } from "@/lib/reader-entry";
import preparedDiscovery from "@/prepared/discovery.json";
import preparedConstellation from "@/prepared/constellation.json";

const CitationGraph = deferredPanel(() => import("@/components/CitationGraph"), "星座视图");
const LineageGraph = deferredPanel(() => import("@/components/lineage/LineageGraph"), "谱系图");
type Work = { openalex_id: string; title: string; authors: string[]; year: number | null; journal: string;
  doi: string; abstract: string; citation_count: number; oa_pdf_url: string | null;
  domain?: string; study_type?: string; related_ids?: string[]; reference_ids?: string[] };
type Paper = { id: string; title: string; openalex_id: string | null; status: string; source_matches?: boolean };
type Search = { items: Work[]; count: number; page: number; mode: "semantic" | "keyword"; cached?: boolean; stale?: boolean; fetched_at?: string; snapshot?: string };
type Graph = { nodes: Work[]; links: { source: string; target: string; relation: string }[]; cached?: boolean; fetched_at?: string };
type DiscoveryView = {
  tab?: "list" | "graph"; graphView?: "lineage" | "constellation";
  lineageCenter?: string; graphCenter?: string; lineageSelected?: string; graphSelected?: string;
};

const domains: Record<string, string> = { biomed: "生物科学", review: "综述", general: "领域待确认" };
const emptySearch: Search = { items: [], count: 0, page: 0, mode: "semantic" };
const exampleSearch: Search = { ...preparedDiscovery.search, mode: "semantic" };
const exampleLineage = preparedDiscovery.lineage as LineageResponse;
const exampleLineages = new Set(preparedDiscovery.preparedLineages);
let lastSearch: { query: string; result: Search } | null = null;

const discoveryViewKey = (query: string, result: Search) =>
  `discover-view:${JSON.stringify([query, result.mode, result.snapshot ?? null])}`;

async function lookup<T>(path: string, controller: AbortController, timeout: number, timeoutMessage: string) {
  const deadline = AbortSignal.timeout(timeout);
  const signal = AbortSignal.any([controller.signal, deadline]);
  try {
    return await apiJson<T>(path, { signal });
  } catch (error) {
    if (deadline.aborted && !controller.signal.aborted) throw new Error(timeoutMessage);
    if (error instanceof TypeError) throw new Error("连接中断，请重试。");
    throw error;
  }
}

export default function DiscoverPage() {
  const router = useRouter();
  const urlQuery = useSearchParams().get("q")?.trim() || "";
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Search>(emptySearch);
  const [resultQuery, setResultQuery] = useState("");
  const [topicConfirmation, setTopicConfirmation] = useState<string | null>(null);
  const [savingTopic, setSavingTopic] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [mode, setMode] = useState<"semantic" | "keyword">("semantic");
  const [saved, setSaved] = useState<Paper[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const libraryWrites = useRef<Map<string, Paper> | null>(null);
  const viewKey = resultQuery ? discoveryViewKey(resultQuery, result) : null;
  const [discoveryView, setDiscoveryView] = useTabDraft<DiscoveryView>(viewKey);
  const tab = discoveryView?.tab ?? "list";
  const graphView = discoveryView?.graphView ?? "lineage";
  const [graph, setGraph] = useState<Graph | null>(null);
  const [lineage, setLineage] = useState<LineageResponse | null>(null);
  const [lineageCenter, setLineageCenter] = useState("");
  const [loadingLineage, setLoadingLineage] = useState(false);
  const [center, setCenter] = useState("");
  const [graphError, setGraphError] = useState("");
  const [lineageError, setLineageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [pendingCenter, setPendingCenter] = useState<string | null>(null);
  const [pendingWorkId, setPendingWorkId] = useState<string | null>(null);
  const [pendingReaderId, setPendingReaderId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [unconfirmedAttachment, setUnconfirmedAttachment] = useState<Paper | null>(null);
  const searchVersion = useRef(0);
  const searchRequest = useRef<AbortController | null>(null);
  const graphRequest = useRef<AbortController | null>(null);
  const lineageRequest = useRef<AbortController | null>(null);
  const readerEntry = useRef<{ id: string; controller: AbortController } | null>(null);
  const lineageTried = useRef<string | null>(null);
  const graphTried = useRef<string | null>(null);
  const initializedEntry = useRef<string | null>(null);
  const active = useRef(false);
  const uploadRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const { workspace, workspaceError, refresh } = useWorkspace();
  function changeView(change: DiscoveryView) {
    if (viewKey) setDiscoveryView({ ...readTabDraft<DiscoveryView>(viewKey), ...change });
  }
  const resultTabs = tabGroup(["list", "graph"] as const, tab, (tab) => changeView({ tab }));
  const relationTabs = tabGroup(["lineage", "constellation"] as const, graphView, (graphView) => changeView({ graphView }));
  const showingLineage = graphView === "lineage";
  const selected = showingLineage
    ? lineage?.nodes.find((item) => item.openalex_id === discoveryView?.lineageSelected) ?? lineage?.center
    : graph?.nodes.find((item) => item.openalex_id === discoveryView?.graphSelected)
      ?? graph?.nodes.find((item) => item.openalex_id === center);
  const relationBusy = showingLineage ? loadingLineage : loadingGraph;
  const relationError = showingLineage ? lineageError : graphError;
  const failedCenter = showingLineage ? lineageTried.current : graphTried.current;
  const activeTopic = workspace?.query.trim() || "";
  const canSetTopic = workspace && resultQuery && activeTopic.toLowerCase() !== resultQuery.toLowerCase();
  // 后端语义检索最多放行 5 页（50 篇），第 6 页直接 422。与其让「加载更多」点出一个错误横幅，
  // 不如在到顶时把按钮改成明确的下一步提示。
  const semanticExhausted = mode === "semantic" && result.items.length >= 50;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      initializedEntry.current = null;
      ++searchVersion.current;
      searchRequest.current?.abort();
      graphRequest.current?.abort();
      lineageRequest.current?.abort();
      readerEntry.current?.controller.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const writes = new Map<string, Paper>();
    libraryWrites.current = writes;
    readPaperLibrary(controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      setSaved([...items.filter((item) => !writes.has(item.id)), ...writes.values()]);
      setLibraryStatus("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setLibraryStatus("error");
    }).finally(() => {
      if (libraryWrites.current === writes) libraryWrites.current = null;
    });
    return () => {
      controller.abort();
      if (libraryWrites.current === writes) libraryWrites.current = null;
    };
  }, [libraryAttempt]);
  useEffect(() => subscribeToPaperLibrary(({ removed }) => {
    setLibraryAttempt((attempt) => attempt + 1);
    if (removed) void refresh(true).catch(() => {});
  }), [refresh]);
  useEffect(() => {
    if ((!urlQuery && !workspace && !workspaceError) || initializedEntry.current === urlQuery) return;
    initializedEntry.current = urlQuery;
    searchRequest.current?.abort();
    const version = ++searchVersion.current;
    setBusy(false); setError("");
    resetRelations();
    const term = urlQuery || workspace?.query || preparedDiscovery.query;
    setQuery(term);
    const previous = lastSearch?.query === term ? lastSearch.result : null;
    const mode = window.localStorage.getItem("medread-search-mode") === "keyword" ? "keyword" : "semantic";
    const defaultExample = term.toLowerCase() === preparedDiscovery.query.toLowerCase();
    const matchingResult = previous?.mode === mode ? previous : defaultExample ? exampleSearch : null;
    setMode(mode);
    setResult(matchingResult || emptySearch);
    setResultQuery(matchingResult ? term : "");
    if (matchingResult === exampleSearch) {
      setMode("semantic");
      const remembered = readTabDraft<DiscoveryView>(discoveryViewKey(term, exampleSearch));
      const exampleCenter = exampleLineage.center.openalex_id;
      if (!remembered?.lineageCenter || remembered.lineageCenter === exampleCenter) {
        setLineage(exampleLineage);
        setLineageCenter(exampleCenter);
      }
      if (!remembered?.graphCenter || remembered.graphCenter === exampleCenter) {
        setGraph(preparedConstellation);
        setCenter(exampleCenter);
      }
    }
    setTopicConfirmation(null);
    if (urlQuery && !matchingResult) {
      void search(1, term, false, mode, true);
      return;
    }
    setRestoring(!!term && !matchingResult);
    if (!term || matchingResult) return;
    const controller = new AbortController();
    searchRequest.current = controller;
    lookup<Search>(`/api/research/discover/cached?q=${encodeURIComponent(term)}&page=1&mode=${mode}`,
      controller, 10000, "恢复上次结果超时，请重新检索。")
      .then((data) => {
        if (searchVersion.current !== version) return;
        lastSearch = { query: term, result: data };
        setResult(data);
        setResultQuery(term);
      }).catch((error) => {
        if (searchVersion.current === version && !(error instanceof ApiError && error.status === 404)) setError("无法恢复上次结果，请重新检索");
      }).finally(() => { if (searchVersion.current === version) setRestoring(false); });
  }, [urlQuery, workspace?.query, workspaceError]);
  // 关系图谱 tab 被选中时按需加载：方向键只走 tabGroup 的 select，不会触发 item 的 onClick，
  // 若只在 onClick 里加载，方向键选中后会留下空图谱。这里统一兜底（loadingGraph 守卫避免重复请求）。
  useEffect(() => {
    if (tab !== "graph" || !result.items.length) return;
    const first = result.items[0].openalex_id;
    if (graphView === "lineage") {
      const wanted = discoveryView?.lineageCenter ?? first;
      if (!lineage && !loadingLineage && lineageTried.current !== wanted) showLineage(wanted);
      return;
    }
    const wanted = discoveryView?.graphCenter ?? first;
    if (!graph && !loadingGraph && graphTried.current !== wanted) showGraph(wanted);
  }, [tab, graphView, lineage, loadingLineage, graph, loadingGraph, result.items.length, discoveryView?.lineageCenter, discoveryView?.graphCenter]);

  function resetRelations() {
    graphRequest.current?.abort();
    lineageRequest.current?.abort();
    graphRequest.current = lineageRequest.current = null;
    graphTried.current = lineageTried.current = null;
    setGraph(null); setLineage(null);
    setCenter(""); setLineageCenter("");
    setGraphError(""); setLineageError("");
    setLoadingGraph(false); setLoadingLineage(false); setPendingCenter(null);
  }

  async function search(page = 1, term = query, bypassCache = false, searchMode = mode, restoringEntry = false) {
    if (!term.trim()) return;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    const version = ++searchVersion.current;
    setRestoring(false); setBusy(true); setBusyLabel("正在检索文献并整理结果"); setError("");
    setTopicConfirmation(null);
    try {
      const next = term.trim();
      const params = new URLSearchParams({ q: next, page: String(page), mode: searchMode });
      if (bypassCache) params.set("refresh", "true");
      if (page > 1 && result.snapshot) params.set("snapshot", result.snapshot);
      const data = await lookup<Search>(
        `/api/research/discover?${params}`,
        controller, 30000, "检索超时，请重试。");
      if (searchVersion.current !== version) return;
      window.localStorage.setItem("medread-search-mode", searchMode);
      const completed = { ...data, items: page === 1 ? data.items : [...result.items, ...data.items] };
      if (page === 1 && !restoringEntry) writeTabDraft(discoveryViewKey(next, completed), null);
      lastSearch = { query: next, result: completed };
      setResult(completed);
      setResultQuery(next);
      if (page === 1) {
        initializedEntry.current = next;
        window.history.replaceState(null, "", `/discover?q=${encodeURIComponent(next)}`);
        resetRelations();
      }
    } catch (e) { if (searchVersion.current === version) setError(e instanceof Error ? e.message : "检索失败"); }
    finally { if (searchVersion.current === version) setBusy(false); }
  }

  async function activateTopic() {
    if (!workspace || !canSetTopic || savingTopic) return;
    if (activeTopic && !topicConfirmation) {
      setTopicConfirmation(workspace.updated_at);
      return;
    }
    setSavingTopic(true); setError("");
    try {
      await changeWorkspaceTopic({
        query: resultQuery,
        domain: result.items[0]?.domain || "general",
        study_type: result.items[0]?.study_type || "unspecified",
      }, topicConfirmation ?? workspace.updated_at);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await refresh(true).catch(() => {});
      setError(e instanceof Error ? e.message : "研究主题保存失败，请重试");
    } finally {
      setTopicConfirmation(null);
      setSavingTopic(false);
    }
  }

  function changeSearchMode(next: Search["mode"]) {
    if (next === mode) return;
    ++searchVersion.current;
    setMode(next);
    setResult({ ...emptySearch, mode: next });
    setResultQuery("");
    setTopicConfirmation(null);
    setError("");
    window.localStorage.setItem("medread-search-mode", next);
    resetRelations();
  }

  async function showGraph(workId: string, refresh = false) {
    if (workId === center && graph && !refresh) return;
    if (graphRequest.current && graphTried.current === workId) return;
    graphTried.current = workId;
    graphRequest.current?.abort();
    const controller = new AbortController();
    graphRequest.current = controller;
    setLoadingGraph(true); setPendingCenter(workId); setGraphError("");
    try {
      const data = !refresh && workId === exampleLineage.center.openalex_id ? preparedConstellation
        : await lookup<Graph>(`/api/research/graph/${workId}${refresh ? "?refresh=true" : ""}`,
          controller, 45000, "星座视图读取超时，请重试。");
      if (controller.signal.aborted) return;
      setGraph(data); setCenter(workId);
      const previous = viewKey ? readTabDraft<DiscoveryView>(viewKey) : null;
      changeView({ graphCenter: workId, graphSelected: previous?.graphCenter === workId ? previous.graphSelected : workId });
    } catch (e) { if (!controller.signal.aborted) setGraphError(e instanceof Error ? e.message : "关系图读取失败"); }
    finally {
      if (graphRequest.current === controller) {
        graphRequest.current = null;
        setLoadingGraph(false); setPendingCenter(null);
      }
    }
  }

  async function showLineage(workId: string, refresh = false) {
    changeView({ tab: "graph", graphView: "lineage" });
    if (workId === lineageCenter && lineage && !refresh) return;
    if (lineageRequest.current && lineageTried.current === workId) return;
    lineageTried.current = workId;
    lineageRequest.current?.abort();
    const controller = new AbortController();
    lineageRequest.current = controller;
    setLoadingLineage(true); setLineageError("");
    try {
      let data: LineageResponse;
      if (!refresh && exampleLineages.has(workId)) {
        if (workId === exampleLineage.center.openalex_id) data = exampleLineage;
        else {
          const response = await fetch(`/prepared-discovery/${encodeURIComponent(workId)}.json`, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
          });
          if (!response.ok) throw new Error("暂时无法读取已保存的谱系。");
          data = await response.json() as LineageResponse;
        }
      } else {
        data = await lookup<LineageResponse>(`/api/research/lineage/${workId}${refresh ? "?refresh=true" : ""}`,
          controller, 45000, "谱系图读取超时，请重试。");
      }
      if (controller.signal.aborted) return;
      setLineage(data); setLineageCenter(workId);
      const previous = viewKey ? readTabDraft<DiscoveryView>(viewKey) : null;
      changeView({ lineageCenter: workId, lineageSelected: previous?.lineageCenter === workId ? previous.lineageSelected : workId });
    } catch (e) {
      if (!controller.signal.aborted) setLineageError(e instanceof Error ? e.message : "谱系图读取失败");
    } finally {
      if (lineageRequest.current === controller) {
        lineageRequest.current = null;
        setLoadingLineage(false);
      }
    }
  }

  function relationText(work: Work) {
    const role = (work as Work & { role?: string }).role;
    if (work.openalex_id === (showingLineage ? lineageCenter : center)) return "当前中心论文";
    if (role === "reference") return "中心论文的参考文献；关系来自 OpenAlex 引用元数据。";
    if (role === "cited_by") return "引用了中心论文的后续研究；箭头方向表示「它引用了中心论文」。";
    if (role === "related") return "OpenAlex 标记的相关研究；具体研究重合点需查看摘要或原文。";
    if (!showingLineage && graph?.links.find((item) => item.target === work.openalex_id)?.relation === "references") {
      return "当前论文的参考文献；关系来自 OpenAlex 引用元数据。";
    }
    return "OpenAlex 标记的相关研究；具体研究重合点需查看摘要或原文。";
  }

  function rememberPaper(paper: Paper) {
    libraryWrites.current?.set(paper.id, paper);
    setSaved((prior) => [...prior.filter((item) => item.id !== paper.id), paper]);
  }

  async function save(work: Work): Promise<Paper> {
    const existing = saved.find((item) => item.openalex_id === work.openalex_id);
    if (existing) return existing;
    const paper = await postJson<Paper>("/api/research/import", { openalex_id: work.openalex_id });
    rememberPaper(paper);
    notifyPaperLibraryChange(paper.id);
    return paper;
  }

  async function runWorkAction(workId: string, action: () => Promise<unknown>) {
    setPendingWorkId(workId); setError("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败，请重试"); }
    finally { setPendingWorkId(null); }
  }

  async function addToCompare(work: Work) {
    const query = (workspace ?? await refresh()).query;
    const paper = await save(work);
    await setPaperInSynthesis(paper.id, true, query);
  }

  async function setCore(work: Work) {
    const version = searchVersion.current;
    const query = (workspace ?? await refresh()).query;
    const paper = await save(work);
    await updateWorkspace({ core_paper_id: paper.id, domain: work.domain || "general" }, query);
    if (version === searchVersion.current) await showLineage(work.openalex_id);
  }

  async function upload(work: Work, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    setUnconfirmedAttachment(null);
    setBusy(true); setBusyLabel("正在上传 PDF"); setError("");
    try {
      const paper = await save(work);
      if (!active.current) return;
      if (paper.status === "parsed" || isPdfParsing(paper.status)) { openReader(paper.id); return; }
      const body = new FormData(); body.append("file", file);
      try {
        // Allow a slow transfer of a large PDF, with a limit for a stalled request.
        await apiJson(`/api/papers/${encodeURIComponent(paper.id)}/attach`, {
          method: "POST", body, signal: AbortSignal.timeout(15 * 60 * 1000),
        });
      } catch (error) {
        if (error instanceof ApiError && error.status < 500 && error.status !== 408 && error.status !== 409) throw error;
        if (active.current) await checkAttachment(paper);
        return;
      }
      notifyPaperLibraryChange(paper.id);
      openReader(paper.id);
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : "上传失败"); }
    finally { if (active.current) setBusy(false); }
  }

  async function checkAttachment(paper: Paper) {
    setBusy(true); setBusyLabel("正在核对上传结果"); setError("");
    try {
      const { status } = await apiJson<Pick<Paper, "status">>(`/api/papers/${encodeURIComponent(paper.id)}/status`, {
        cache: "no-store", signal: AbortSignal.timeout(10000),
      });
      if (!active.current) return;
      if (status === "parsed" || isPdfParsing(status) || (status === "failed" && paper.status !== "failed")) {
        rememberPaper({ ...paper, status });
        notifyPaperLibraryChange(paper.id);
        setUnconfirmedAttachment(null);
        openReader(paper.id);
        return;
      }
    } catch (error) {
      if (!active.current) return;
      if (error instanceof ApiError && error.status === 404) {
        setSaved((current) => current.filter((item) => item.id !== paper.id));
        setUnconfirmedAttachment(null);
        setError("这篇论文已不在论文库，可以重新选择 PDF 上传。");
        return;
      }
    } finally {
      if (active.current) setBusy(false);
    }
    if (!active.current) return;
    setUnconfirmedAttachment(paper);
  }

  async function importOpenPdf(work: Work) {
    setBusy(true); setBusyLabel("正在获取开放 PDF"); setError("");
    try {
      const result = await postJson<Paper>("/api/research/import-pdf", { openalex_id: work.openalex_id });
      rememberPaper(result);
      notifyPaperLibraryChange(result.id);
      openReader(result.id);
    } catch (e) { setError(e instanceof Error ? e.message : "开放 PDF 暂时不可用，请手动上传"); }
    finally { setBusy(false); }
  }

  async function openReader(id: string) {
    if (!active.current || readerEntry.current?.id === id) return;
    readerEntry.current?.controller.abort();
    const controller = new AbortController();
    readerEntry.current = { id, controller };
    const href = `/read?paper=${encodeURIComponent(id)}`;
    setPendingReaderId(id);
    setError("");
    router.prefetch(href);
    try {
      await prepareReaderEntry(id, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
      if (!controller.signal.aborted && active.current) router.push(href);
    } catch (error) {
      if (!controller.signal.aborted && active.current) {
        setError(error instanceof ApiError ? error.message : "暂时无法打开论文，可以重试。");
      }
    } finally {
      if (readerEntry.current?.controller === controller) {
        readerEntry.current = null;
        if (active.current) setPendingReaderId(null);
      }
    }
  }

  function workCard(work: Work, compact = false) {
    const paper = saved.find((item) => item.openalex_id === work.openalex_id);
    const fulltext = hasParsedPdf(paper);
    const parsing = !!paper && isPdfParsing(paper.status);
    const pdfStatus = fulltext ? "已有全文" : paper ? paperLibraryIssue(paper)
      : libraryStatus === "ready" ? "尚无全文" : libraryStatus === "loading" ? "正在核对全文" : "全文状态待确认";
    const linkLabel = fulltext ? "打开全文精读" : parsing ? "查看解析进度" : "打开论文处理";
    const opening = !!paper && pendingReaderId === paper.id;
    const acting = pendingWorkId === work.openalex_id || opening;
    return <article key={work.openalex_id} className={`workCard ${compact ? "compact" : ""}`}>
      <div className="workMeta"><span>{domains[work.domain || ""] || "领域待确认"}</span><span>{work.year || "年份未知"}</span><span>{work.journal || "来源未知"}</span><span>被引 {work.citation_count}</span><span className={`workAccess ${fulltext ? "fulltext" : ""}`}>{pdfStatus}</span>{acting && <span className="workPending" role="status">正在处理…</span>}</div>
      <h3>{work.title}</h3><p className="workAuthors">{work.authors.slice(0, 4).join(" · ") || "作者未提供"}</p>
      {work.abstract && <p className="workAbstract">{work.abstract}</p>}
      <div className="workPrimaryActions"><button onClick={() => showLineage(work.openalex_id)} disabled={busy || !!pendingWorkId} aria-busy={busy || !!pendingWorkId}>浏览文献谱系 <span>↗</span></button>{paper && (paper.status === "parsed" || parsing) ? <Link href={`/read?paper=${encodeURIComponent(paper.id)}`} aria-busy={opening} onNavigate={(event) => { event.preventDefault(); void openReader(paper.id); }}>{linkLabel} <span>→</span></Link> : <label tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); uploadRefs.current[work.openalex_id]?.click(); } }}>上传 PDF 精读 <span>→</span><input type="file" accept=".pdf,application/pdf" hidden ref={(el) => { uploadRefs.current[work.openalex_id] = el; }} onChange={(e) => upload(work, e)} disabled={busy} /></label>}</div>
      <details className="workMore"><summary>保存、对比与其他操作 <span>＋</span></summary><div className="workActions"><button onClick={() => runWorkAction(work.openalex_id, () => setCore(work))} disabled={busy || !!pendingWorkId} aria-busy={busy || !!pendingWorkId}>设为研究中心</button><button onClick={() => runWorkAction(work.openalex_id, () => addToCompare(work))} disabled={busy || !!pendingWorkId} aria-busy={busy || !!pendingWorkId}>{workspace?.selected_paper_ids.includes(paper?.id || "") ? "已加入对比" : "加入对比"}</button>{paper ? <span className="workSaved">已存入论文库</span> : <button onClick={() => runWorkAction(work.openalex_id, () => save(work))} disabled={busy || !!pendingWorkId} aria-busy={busy || !!pendingWorkId}>保存检索记录</button>}{work.oa_pdf_url && !parsing && paper?.status !== "parsed" && <button onClick={() => importOpenPdf(work)} disabled={busy} aria-busy={busy}>尝试获取开放 PDF</button>}</div></details>
      {(paper || libraryStatus === "ready") && !parsing && paper?.status !== "parsed" && <small className="evidenceNote">当前仅展示检索信息与可用摘要；逐页精读需先取得全文。</small>}
    </article>;
  }

  return <PageMain route="/discover" className="researchPage">
    <div className="pageIntro"><div className="eyebrow">01 / DISCOVER</div><h1>从一个问题，找到值得深读的论文。</h1><p>检索 OpenAlex 中标注为生命科学或健康科学的文献；自动分类可能遗漏相关研究，请核对原文。</p></div>
    <form className="searchBox" onSubmit={(e) => { e.preventDefault(); search(1); }}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例如：单细胞测序如何揭示肿瘤耐药机制？" aria-label="论文检索" /><button disabled={busy || !query.trim()} aria-busy={busy}>{busy ? "检索中…" : "检索论文 ↗"}</button></form>
    <div className="searchModes"><button className={mode === "semantic" ? "active" : ""} disabled={busy || restoring} onClick={() => changeSearchMode("semantic")}>语义检索</button><button className={mode === "keyword" ? "active" : ""} disabled={busy || restoring} onClick={() => changeSearchMode("keyword")}>关键词检索</button><span>语义检索最多展示 50 篇；关键词检索适合精确题名。</span></div>
    {!result.items.length && <div className="suggestions">试试：{["single cell RNA sequencing cancer", "tumor immune microenvironment", "gene expression metabolic pathway", "CRISPR cell function"].map((term) => <button key={term} onClick={() => { setQuery(term); search(1, term); }}>{term}</button>)}</div>}
    {error && <div className="researchError" role="alert">{error}</div>}
    {unconfirmedAttachment && <div className="workspaceLoading">
      <p role="alert">暂时无法确认 PDF 是否已上传：{unconfirmedAttachment.title}</p>
      <button type="button" className="quietButton" disabled={busy} onClick={() => void checkAttachment(unconfirmedAttachment)}>核对上传进度</button>
    </div>}
    {libraryStatus === "error" && <div className="workspaceLoading">
      <p role="alert">暂时无法核对论文库中的全文状态。</p>
      <button type="button" className="quietButton" onClick={() => {
        setLibraryStatus("loading");
        setLibraryAttempt((attempt) => attempt + 1);
      }}>重试读取论文库</button>
    </div>}
    {busy && <StepLoading title={busyLabel || "正在处理"} steps={busyLabel.includes("检索") ? ["理解检索词", "查询 OpenAlex 或本地缓存", "整理论文信息与关系"] : busyLabel === "正在核对上传结果" ? ["核对论文当前解析状态"] : ["保留论文记录", "提取全文与页码", "建立可核验的精读目录"]} />}
    {restoring && <p className="workspaceLoading" role="status">正在恢复上次检索…</p>}
    {!!result.items.length && <section className="workspaceLoading" aria-label="研究主题" style={{ overflowWrap: "anywhere" }}>
      <p>当前研究主题 · {activeTopic || (workspace ? "尚未设置" : workspaceError || "正在读取")}</p>
      {canSetTopic && <>
        {topicConfirmation && <p>切换到「{resultQuery}」会清空待综合列表，并重置当前中心论文、综合和设计进度。已入库论文和已保存的结果会保留。</p>}
        <div className="actionRow">
          <button type="button" className="quietButton" onClick={topicConfirmation ? () => setTopicConfirmation(null) : activateTopic}
            disabled={busy || savingTopic}>{topicConfirmation ? "保留当前主题" : savingTopic ? "正在保存…" : "将本次检索设为研究主题"}</button>
          {topicConfirmation && <button type="button" className="quietButton" onClick={activateTopic} disabled={busy || savingTopic}>{savingTopic ? "正在切换…" : "确认切换主题"}</button>}
        </div>
      </>}
    </section>}
    {result.page === 0 && !restoring && !busy && !error && <div className="discoverStarter"><div><span className="sectionLabel">HOW IT WORKS</span><h2>先检索，再决定读哪篇</h2><p>输入研究问题后，先查看摘要和论文关系；找到相关文献，再获取或上传 PDF 进入全文精读。</p></div><ol><li><b>01</b><span>检索主题</span></li><li><b>02</b><span>查看论文关系</span></li><li><b>03</b><span>取得 PDF 后精读</span></li></ol></div>}
    {result.page > 0 && !result.items.length && !busy && !error && <p className="workspaceLoading" role="status">没有找到匹配的论文。可以换一个检索词或切换检索方式。</p>}
    {!!result.items.length && <><div className="resultBar"><div><strong>{result.count.toLocaleString()}</strong> 条相关记录 <span>· 当前展示 {result.items.length} 篇</span>{result.cached && <small className="cacheStamp"> · 缓存结果{result.fetched_at ? ` · ${new Date(result.fetched_at).toLocaleString("zh-CN")}` : ""}{result.stale ? " · 当前网络不可用" : ""}</small>}</div><div className="resultBarActions"><button className="quietButton" disabled={busy} aria-busy={busy} onClick={() => search(1, lastSearch?.query || query, true, result.mode)}>刷新结果</button><div className="tabBar" {...resultTabs.list} aria-label="结果视图"><button {...resultTabs.item("list")}>列表</button><button {...resultTabs.item("graph")}>文献谱系</button></div></div></div>
      {tab === "list" ? <><div className="workList">{result.items.map((work) => workCard(work))}</div><button className="moreButton" disabled={busy || semanticExhausted || result.items.length >= result.count} aria-busy={busy} onClick={() => search(result.page + 1, lastSearch?.query || query)}>{semanticExhausted ? "语义检索上限 50 篇，请改用关键词检索" : busy ? "加载中…" : "加载更多论文"}</button></> :
      <>
        <div className="graphViews" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <div className="tabBar" {...relationTabs.list} aria-label="文献关系视图">
            <button type="button" {...relationTabs.item("lineage")}>谱系图</button>
            <button type="button" {...relationTabs.item("constellation")}>星座视图</button>
          </div>
        </div>
        {relationError && <div className="researchError" role="alert">{relationError} {failedCenter && <button type="button" className="quietButton" onClick={() => showingLineage ? showLineage(failedCenter, true) : showGraph(failedCenter, true)}>重试读取</button>}</div>}
        <div className="graphLayout"><div className="graphRegion">
          {graphView === "lineage" ? (
            <>
              {lineage?.cached && <p className="graphInstruction">缓存的谱系数据 · {lineage.fetched_at ? new Date(lineage.fetched_at).toLocaleString("zh-CN") : ""}</p>}
              <LineageGraph
                data={lineage}
                selectedId={selected?.openalex_id}
                onSelect={(lineageSelected) => changeView({ lineageSelected })}
                onRecenter={(id) => showLineage(id)}
                loading={loadingLineage}
              />
            </>
          ) : (
            <>
              {graph?.cached && <p className="graphInstruction">缓存图谱 · {graph.fetched_at ? new Date(graph.fetched_at).toLocaleString("zh-CN") : ""}</p>}
              {graph && <CitationGraph works={graph.nodes} links={graph.links} center={center} selectedId={selected?.openalex_id}
                onSelect={(graphSelected) => changeView({ graphSelected })} />}
              {loadingGraph && <div className="graphLoading" role="status"><div className="graphLoadingTrack"><i /></div><span>正在切换中心论文</span><strong>{graph?.nodes.find((item) => item.openalex_id === pendingCenter)?.title || result.items.find((item) => item.openalex_id === pendingCenter)?.title || "正在读取文献关系"}</strong><small>保留当前视图，关系数据就绪后展开新图谱</small></div>}
            </>
          )}
        </div><aside className="graphAside" key={`${graphView}-${showingLineage ? lineageCenter : center}`}>{selected ? <><div className="relationSummary"><strong>与中心论文的关系</strong><p>{relationText(selected)}</p></div>{workCard(selected, true)}<button className="moreButton" onClick={() => (showingLineage ? showLineage(selected.openalex_id) : showGraph(selected.openalex_id))} disabled={busy || relationBusy || selected.openalex_id === (showingLineage ? lineageCenter : center)} aria-busy={relationBusy}>{relationBusy ? "正在展开…" : selected.openalex_id === (showingLineage ? lineageCenter : center) ? "当前中心论文" : "以这篇论文为中心展开 →"}</button></> : <p>选择一篇论文查看摘要与可用操作。</p>}</aside></div>
      </>}
</>}
    {!!workspace?.selected_paper_ids.length && (
      <div className="compareTray">
        <strong>待综合 · {workspace.selected_paper_ids.length} / 5</strong>
        <div className="compareTrayList" role="list" aria-label="待综合论文">
          {workspace.selected_paper_ids.map((id) => {
            const title = saved.find((paper) => paper.id === id)?.title || "已选论文";
            return (
              <div className="compareTrayPaper" key={id} role="listitem">
                <small title={title}>{title}</small>
                <button type="button" title="移出待综合论文" aria-label={`移出 ${title}`}
                  onClick={() => setPaperInSynthesis(id, false, workspace.query).catch((e) => setError(e.message))}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <Link href="/synthesis">开始综合 →</Link>
      </div>
    )}
  </PageMain>;
}
