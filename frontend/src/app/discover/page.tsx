"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import StepLoading from "@/components/StepLoading";
import type { LineageResponse } from "@/components/lineage/lineageLayout";
import { API, ApiError, apiJson, postJson } from "@/lib/api";
import { changeWorkspaceTopic, setPaperInSynthesis, updateWorkspace, useWorkspace } from "@/lib/workspace";
import { tabGroup } from "@/lib/tabs";
import { deferredPanel } from "@/components/deferred-panel";

const CitationGraph = deferredPanel(() => import("@/components/CitationGraph"), "星座视图");
const LineageGraph = deferredPanel(() => import("@/components/lineage/LineageGraph"), "谱系图");
type Work = { openalex_id: string; title: string; authors: string[]; year: number | null; journal: string;
  doi: string; abstract: string; citation_count: number; oa_pdf_url: string | null;
  domain?: string; study_type?: string; related_ids?: string[]; reference_ids?: string[] };
type Paper = { id: string; title: string; openalex_id: string | null; status: string };
type Search = { items: Work[]; count: number; page: number; mode: "semantic" | "keyword"; cached?: boolean; stale?: boolean; fetched_at?: string };
type Graph = { nodes: Work[]; links: { source: string; target: string; relation: string }[]; cached?: boolean; fetched_at?: string };

const domains: Record<string, string> = { biomed: "生物科学", review: "综述", general: "领域待确认" };
const emptySearch: Search = { items: [], count: 0, page: 0, mode: "semantic" };
let lastSearch: { query: string; result: Search } | null = null;

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
  const [tab, setTab] = useState<"list" | "graph">("list");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [graphView, setGraphView] = useState<"lineage" | "constellation">("lineage");
  const [lineage, setLineage] = useState<LineageResponse | null>(null);
  const [lineageCenter, setLineageCenter] = useState("");
  const [loadingLineage, setLoadingLineage] = useState(false);
  const [center, setCenter] = useState("");
  const [graphSelection, setGraphSelection] = useState<Work | null>(null);
  const [lineageSelection, setLineageSelection] = useState<Work | null>(null);
  const [graphError, setGraphError] = useState("");
  const [lineageError, setLineageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [pendingCenter, setPendingCenter] = useState<string | null>(null);
  const [pendingWorkId, setPendingWorkId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const searchVersion = useRef(0);
  const searchRequest = useRef<AbortController | null>(null);
  const graphRequest = useRef<AbortController | null>(null);
  const lineageRequest = useRef<AbortController | null>(null);
  const lineageTried = useRef<string | null>(null);
  const graphTried = useRef<string | null>(null);
  const initializedEntry = useRef<string | null>(null);
  const active = useRef(false);
  const uploadRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const { workspace, workspaceError, refresh } = useWorkspace();
  const resultTabs = tabGroup(["list", "graph"] as const, tab, setTab);
  const relationTabs = tabGroup(["lineage", "constellation"] as const, graphView, setGraphView);
  const showingLineage = graphView === "lineage";
  const selected = showingLineage ? lineageSelection : graphSelection;
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
    apiJson<Paper[]>("/api/papers").then((items) => { if (active.current) setSaved(items); }).catch(() => {});
    return () => {
      active.current = false;
      initializedEntry.current = null;
      ++searchVersion.current;
      searchRequest.current?.abort();
      graphRequest.current?.abort();
      lineageRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if ((!urlQuery && !workspace && !workspaceError) || initializedEntry.current === urlQuery) return;
    initializedEntry.current = urlQuery;
    searchRequest.current?.abort();
    const version = ++searchVersion.current;
    setBusy(false); setError("");
    resetRelations();
    const term = urlQuery || workspace?.query || "";
    setQuery(term);
    const previous = lastSearch?.query === term ? lastSearch.result : null;
    const mode = window.localStorage.getItem("medread-search-mode") === "keyword" ? "keyword" : "semantic";
    const matchingResult = previous?.mode === mode ? previous : null;
    setMode(mode);
    setResult(matchingResult || emptySearch);
    setResultQuery(matchingResult ? term : "");
    setTopicConfirmation(null);
    if (urlQuery && !matchingResult) {
      void search(1, term, false, mode);
      return;
    }
    setRestoring(!!term && !matchingResult);
    if (!term || matchingResult) return;
    const controller = new AbortController();
    searchRequest.current = controller;
    apiJson<Search>(`/api/research/discover/cached?q=${encodeURIComponent(term)}&page=1&mode=${mode}`, { signal: controller.signal })
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
      if (!lineage && !loadingLineage && lineageTried.current !== first) showLineage(first);
      return;
    }
    if (!graph && !loadingGraph && graphTried.current !== first) showGraph(first);
  }, [tab, graphView, lineage, loadingLineage, graph, loadingGraph, result.items.length]);

  function resetRelations() {
    graphRequest.current?.abort();
    lineageRequest.current?.abort();
    graphRequest.current = lineageRequest.current = null;
    graphTried.current = lineageTried.current = null;
    setTab("list");
    setGraph(null); setLineage(null);
    setCenter(""); setLineageCenter("");
    setGraphSelection(null); setLineageSelection(null);
    setGraphError(""); setLineageError("");
    setLoadingGraph(false); setLoadingLineage(false); setPendingCenter(null);
  }

  async function search(page = 1, term = query, bypassCache = false, searchMode = mode) {
    if (!term.trim()) return;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    const version = ++searchVersion.current;
    setRestoring(false); setBusy(true); setBusyLabel("正在检索文献并整理结果"); setError("");
    setTopicConfirmation(null);
    try {
      const next = term.trim();
      const data = await apiJson<Search>(`/api/research/discover?q=${encodeURIComponent(next)}&page=${page}&mode=${searchMode}${bypassCache ? "&refresh=true" : ""}`, { signal: controller.signal });
      if (searchVersion.current !== version) return;
      window.localStorage.setItem("medread-search-mode", searchMode);
      const completed = { ...data, items: page === 1 ? data.items : [...result.items, ...data.items] };
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
      const data = await apiJson<Graph>(`/api/research/graph/${workId}${refresh ? "?refresh=true" : ""}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setGraph(data); setCenter(workId); setGraphSelection(data.nodes.find((item) => item.openalex_id === workId) || null);
    } catch (e) { if (!controller.signal.aborted) setGraphError(e instanceof Error ? e.message : "关系图读取失败"); }
    finally {
      if (graphRequest.current === controller) {
        graphRequest.current = null;
        setLoadingGraph(false); setPendingCenter(null);
      }
    }
  }

  async function showLineage(workId: string, refresh = false) {
    setTab("graph"); setGraphView("lineage");
    if (workId === lineageCenter && lineage && !refresh) return;
    if (lineageRequest.current && lineageTried.current === workId) return;
    lineageTried.current = workId;
    lineageRequest.current?.abort();
    const controller = new AbortController();
    lineageRequest.current = controller;
    setLoadingLineage(true); setLineageError("");
    try {
      const data = await apiJson<LineageResponse>(`/api/research/lineage/${workId}${refresh ? "?refresh=true" : ""}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setLineage(data); setLineageCenter(workId);
      const centerNode = data.nodes.find((item) => item.openalex_id === workId);
      setLineageSelection(centerNode || data.center);
    } catch (e) {
      if (!controller.signal.aborted) setLineageError(e instanceof Error ? e.message : "谱系图读取失败");
    } finally {
      if (lineageRequest.current === controller) {
        lineageRequest.current = null;
        setLoadingLineage(false);
      }
    }
  }

  function selectLineageNode(id: string) {
    if (!lineage) return;
    if (lineage.center.openalex_id === id) { setLineageSelection(lineage.center); return; }
    const node = lineage.nodes.find((item) => item.openalex_id === id);
    if (node) setLineageSelection(node);
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

  async function save(work: Work): Promise<Paper> {
    const existing = saved.find((item) => item.openalex_id === work.openalex_id);
    if (existing) return existing;
    const paper = await postJson<Paper>("/api/research/import", { openalex_id: work.openalex_id });
    setSaved((prior) => [...prior.filter((item) => item.id !== paper.id), paper]);
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
    if (!file) return;
    setBusy(true); setBusyLabel("正在上传 PDF"); setError("");
    try {
      const paper = await save(work);
      if (!active.current) return;
      if (paper.status === "parsed") { openReader(paper.id); return; }
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`${API}/api/papers/${paper.id}/attach`, { method: "POST", credentials: "include", body });
      if (!response.ok) { const data = await response.json(); throw new Error(data.detail || "上传 PDF 失败"); }
      openReader(paper.id);
    } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); }
    finally { setBusy(false); event.target.value = ""; }
  }

  async function importOpenPdf(work: Work) {
    setBusy(true); setBusyLabel("正在获取开放 PDF"); setError("");
    try {
      const result = await postJson<Paper>("/api/research/import-pdf", { openalex_id: work.openalex_id });
      setSaved((items) => [...items.filter((item) => item.id !== result.id), result]);
      openReader(result.id);
    } catch (e) { setError(e instanceof Error ? e.message : "开放 PDF 暂时不可用，请手动上传"); }
    finally { setBusy(false); }
  }

  function openReader(id: string) {
    if (active.current) router.push(`/read?paper=${encodeURIComponent(id)}`);
  }

  function workCard(work: Work, compact = false) {
    const paper = saved.find((item) => item.openalex_id === work.openalex_id);
    const acting = pendingWorkId === work.openalex_id;
    return <article key={work.openalex_id} className={`workCard ${compact ? "compact" : ""}`}>
      <div className="workMeta"><span>{domains[work.domain || ""] || "领域待确认"}</span><span>{work.year || "年份未知"}</span><span>{work.journal || "来源未知"}</span><span>被引 {work.citation_count}</span><span className={`workAccess ${paper?.status === "parsed" ? "fulltext" : ""}`}>{paper?.status === "parsed" ? "已有全文" : "尚无全文"}</span>{acting && <span className="workPending" role="status">正在处理…</span>}</div>
      <h3>{work.title}</h3><p className="workAuthors">{work.authors.slice(0, 4).join(" · ") || "作者未提供"}</p>
      {work.abstract && <p className="workAbstract">{work.abstract}</p>}
      <div className="workPrimaryActions"><button onClick={() => showLineage(work.openalex_id)} disabled={busy || !!pendingWorkId} aria-busy={busy || !!pendingWorkId}>浏览文献谱系 <span>↗</span></button>{paper?.status === "parsed" ? <Link href={`/read?paper=${paper.id}`}>打开全文精读 <span>→</span></Link> : <label tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); uploadRefs.current[work.openalex_id]?.click(); } }}>上传 PDF 精读 <span>→</span><input type="file" accept=".pdf,application/pdf" hidden ref={(el) => { uploadRefs.current[work.openalex_id] = el; }} onChange={(e) => upload(work, e)} disabled={busy} /></label>}</div>
      <details className="workMore"><summary>保存、对比与其他操作 <span>＋</span></summary><div className="workActions"><button onClick={() => runWorkAction(work.openalex_id, () => setCore(work))} disabled={busy || !!pendingWorkId} aria-busy={busy || !!pendingWorkId}>设为研究中心</button><button onClick={() => runWorkAction(work.openalex_id, () => addToCompare(work))} disabled={busy || !!pendingWorkId} aria-busy={busy || !!pendingWorkId}>{workspace?.selected_paper_ids.includes(paper?.id || "") ? "已加入对比" : "加入对比"}</button>{paper ? <span className="workSaved">已存入论文库</span> : <button onClick={() => runWorkAction(work.openalex_id, () => save(work))} disabled={busy || !!pendingWorkId} aria-busy={busy || !!pendingWorkId}>保存检索记录</button>}{work.oa_pdf_url && paper?.status !== "parsed" && <button onClick={() => importOpenPdf(work)} disabled={busy} aria-busy={busy}>尝试获取开放 PDF</button>}</div></details>
      {paper?.status !== "parsed" && <small className="evidenceNote">当前仅展示检索信息与可用摘要；逐页精读需先取得全文。</small>}
    </article>;
  }

  return <main id="main" className="researchPage">
    <div className="pageIntro"><div className="eyebrow">01 / DISCOVER</div><h1>从一个问题，找到值得深读的论文。</h1><p>检索 OpenAlex 中标注为生命科学或健康科学的文献；自动分类可能遗漏相关研究，请核对原文。</p></div>
    <form className="searchBox" onSubmit={(e) => { e.preventDefault(); search(1); }}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例如：单细胞测序如何揭示肿瘤耐药机制？" aria-label="论文检索" /><button disabled={busy || !query.trim()} aria-busy={busy}>{busy ? "检索中…" : "检索论文 ↗"}</button></form>
    <div className="searchModes"><button className={mode === "semantic" ? "active" : ""} disabled={busy || restoring} onClick={() => changeSearchMode("semantic")}>语义检索</button><button className={mode === "keyword" ? "active" : ""} disabled={busy || restoring} onClick={() => changeSearchMode("keyword")}>关键词检索</button><span>语义检索最多展示 50 篇；关键词检索适合精确题名。</span></div>
    {!result.items.length && <div className="suggestions">试试：{["single cell RNA sequencing cancer", "tumor immune microenvironment", "gene expression metabolic pathway", "CRISPR cell function"].map((term) => <button key={term} onClick={() => { setQuery(term); search(1, term); }}>{term}</button>)}</div>}
    {error && <div className="researchError" role="alert">{error}</div>}
    {busy && <StepLoading title={busyLabel || "正在处理"} steps={busyLabel.includes("检索") ? ["理解检索词", "查询 OpenAlex 或本地缓存", "整理论文信息与关系"] : ["保留论文记录", "提取全文与页码", "建立可核验的精读目录"]} />}
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
                onSelect={selectLineageNode}
                onRecenter={(id) => showLineage(id)}
                loading={loadingLineage}
              />
            </>
          ) : (
            <>
              {graph?.cached && <p className="graphInstruction">缓存图谱 · {graph.fetched_at ? new Date(graph.fetched_at).toLocaleString("zh-CN") : ""}</p>}
              {graph && <CitationGraph works={graph.nodes} links={graph.links} center={center} selectedId={selected?.openalex_id} onSelect={(id) => { const work = graph.nodes.find((item) => item.openalex_id === id); if (work) setGraphSelection(work); }} />}
              {loadingGraph && <div className="graphLoading" role="status"><div className="graphLoadingTrack"><i /></div><span>正在切换中心论文</span><strong>{graph?.nodes.find((item) => item.openalex_id === pendingCenter)?.title || result.items.find((item) => item.openalex_id === pendingCenter)?.title || "正在读取文献关系"}</strong><small>保留当前视图，关系数据就绪后展开新图谱</small></div>}
            </>
          )}
        </div><aside className="graphAside" key={`${graphView}-${showingLineage ? lineageCenter : center}`}>{selected ? <><div className="relationSummary"><strong>与中心论文的关系</strong><p>{relationText(selected)}</p></div>{workCard(selected, true)}<button className="moreButton" onClick={() => (showingLineage ? showLineage(selected.openalex_id) : showGraph(selected.openalex_id))} disabled={busy || relationBusy || selected.openalex_id === (showingLineage ? lineageCenter : center)} aria-busy={relationBusy}>{relationBusy ? "正在展开…" : selected.openalex_id === (showingLineage ? lineageCenter : center) ? "当前中心论文" : "以这篇论文为中心展开 →"}</button></> : <p>选择一篇论文查看摘要与可用操作。</p>}</aside></div>
      </>}
</>}
    {!!workspace?.selected_paper_ids.length && <div className="compareTray"><strong>待综合 · {workspace.selected_paper_ids.length} / 5</strong><div>{workspace.selected_paper_ids.map((id) => <span key={id} title={saved.find((item) => item.id === id)?.title || "已选论文"}>{saved.find((item) => item.id === id)?.title || "已选论文"}<button title="移出待综合论文" aria-label={`移出 ${saved.find((item) => item.id === id)?.title || "论文"}`} onClick={() => setPaperInSynthesis(id, false, workspace.query).catch((e) => setError(e.message))}>×</button></span>)}</div><Link href="/synthesis">开始综合 →</Link></div>}
  </main>;
}
