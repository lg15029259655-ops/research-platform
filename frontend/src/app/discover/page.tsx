"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import ResearchNav from "@/components/ResearchNav";
import StepLoading from "@/components/StepLoading";
import { API, apiJson, postJson } from "@/lib/api";
import { updateWorkspace, useWorkspace } from "@/lib/workspace";
import "../research.css";
import "../studio.css";

const CitationGraph = dynamic(() => import("@/components/CitationGraph"), { ssr: false });
type Work = { openalex_id: string; title: string; authors: string[]; year: number | null; journal: string;
  doi: string; abstract: string; citation_count: number; oa_pdf_url: string | null;
  domain?: string; study_type?: string; related_ids: string[]; reference_ids: string[] };
type Paper = { id: string; title: string; openalex_id: string | null; status: string };
type Search = { items: Work[]; count: number; page: number; mode: "semantic" | "keyword"; cached?: boolean; stale?: boolean; fetched_at?: string };
type Graph = { nodes: Work[]; links: { source: string; target: string; relation: string }[]; cached?: boolean; fetched_at?: string };

const domains: Record<string, string> = { biomed: "生物医学", cs: "计算机 / AI", materials: "材料 / 化学", engineering: "工程", social: "社会科学", general: "跨学科" };

export default function DiscoverPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Search>({ items: [], count: 0, page: 0, mode: "semantic" });
  const [mode, setMode] = useState<"semantic" | "keyword">("semantic");
  const [saved, setSaved] = useState<Paper[]>([]);
  const [tab, setTab] = useState<"list" | "graph">("list");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [center, setCenter] = useState("");
  const [selected, setSelected] = useState<Work | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [pendingCenter, setPendingCenter] = useState<string | null>(null);
  const [pendingWorkId, setPendingWorkId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const searchVersion = useRef(0);
  const graphVersion = useRef(0);
  const { workspace } = useWorkspace();
  useEffect(() => { apiJson<Paper[]>("/api/papers").then(setSaved).catch(() => {}); }, []);
  useEffect(() => {
    if (!workspace?.query || query) return;
    const previousQuery = workspace.query;
    const version = searchVersion.current;
    setQuery(previousQuery);
    apiJson<Search>(`/api/research/discover/cached?q=${encodeURIComponent(previousQuery)}&page=1&mode=semantic`)
      .then((data) => { if (searchVersion.current === version) setResult(data); })
      .catch(() => {});
  }, [workspace?.query]);

  async function search(page = 1, term = query, refresh = false) {
    if (!term.trim()) return;
    const version = ++searchVersion.current;
    setBusy(true); setBusyLabel("正在检索文献并整理结果"); setError("");
    try {
      const data = await apiJson<Search>(`/api/research/discover?q=${encodeURIComponent(term.trim())}&page=${page}&mode=${mode}${refresh ? "&refresh=true" : ""}`);
      if (searchVersion.current !== version) return;
      setResult((prior) => ({ ...data, items: page === 1 ? data.items : [...prior.items, ...data.items] }));
      if (page === 1) {
        const next = term.trim();
        const newTopic = !!workspace?.query && workspace.query.trim().toLocaleLowerCase() !== next.toLocaleLowerCase();
        await updateWorkspace({ query: next, domain: data.items[0]?.domain || "general",
          study_type: data.items[0]?.study_type || "unspecified",
          ...(newTopic ? { selected_paper_ids: [], core_paper_id: null, synthesis_id: null,
            research_gap: "", gap_context: {}, design_idea: "", novelty_id: null,
            design_version_id: null } : {}) });
      }
      if (page === 1) { setTab("list"); setSelected(null); setGraph(null); }
    } catch (e) { setError(e instanceof Error ? e.message : "检索失败"); }
    finally { setBusy(false); }
  }

  async function showGraph(workId: string, refresh = false) {
    if (workId === center && graph && !refresh) return;
    const version = ++graphVersion.current;
    setBusy(true); setBusyLabel("正在读取文献关系"); setLoadingGraph(true); setPendingCenter(workId); setError(""); setTab("graph");
    try {
      const data = await apiJson<Graph>(`/api/research/graph/${workId}${refresh ? "?refresh=true" : ""}`);
      if (graphVersion.current !== version) return;
      setGraph(data); setCenter(workId); setSelected(data.nodes.find((item) => item.openalex_id === workId) || null);
    } catch (e) { if (graphVersion.current === version) setError(e instanceof Error ? e.message : "关系图读取失败"); }
    finally { if (graphVersion.current === version) { setBusy(false); setLoadingGraph(false); setPendingCenter(null); } }
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
    const paper = await save(work);
    const ids = workspace?.selected_paper_ids || [];
    if (!ids.includes(paper.id)) {
      if (ids.length >= 5) throw new Error("最多选择 5 篇论文");
      await updateWorkspace({ selected_paper_ids: [...ids, paper.id] });
    }
  }

  async function setCore(work: Work) {
    const paper = await save(work);
    await updateWorkspace({ core_paper_id: paper.id, domain: work.domain || "general" });
    await showGraph(work.openalex_id);
  }

  async function upload(work: Work, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setBusyLabel("正在上传 PDF"); setError("");
    try {
      const paper = await save(work);
      if (paper.status === "parsed") { router.push(`/read?paper=${paper.id}`); return; }
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`${API}/api/papers/${paper.id}/attach`, { method: "POST", credentials: "include", body });
      if (!response.ok) { const data = await response.json(); throw new Error(data.detail || "上传 PDF 失败"); }
      setBusyLabel("PDF 已上传，正在解析全文与页码");
      for (let attempt = 0; attempt < 120; attempt++) {
        const updated = await apiJson<Paper>(`/api/papers/${paper.id}`);
        if (updated.status === "figures") setBusyLabel("正在定位 Figure 与 Table");
        else if (updated.status === "manifest") setBusyLabel("正在建立逐步精读目录");
        if (updated.status === "parsed") { router.push(`/read?paper=${paper.id}`); return; }
        if (updated.status === "failed") throw new Error("PDF 解析失败，请核对文件后重试");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("PDF 仍在解析，请稍后从论文库打开");
    } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); }
    finally { setBusy(false); event.target.value = ""; }
  }

  async function importOpenPdf(work: Work) {
    setBusy(true); setBusyLabel("正在获取开放 PDF"); setError("");
    try {
      const result = await postJson<Paper>("/api/research/import-pdf", { openalex_id: work.openalex_id });
      setBusyLabel("开放 PDF 已取得，正在解析全文");
      setSaved((items) => [...items.filter((item) => item.id !== result.id), result]);
      if (result.status === "parsed") { router.push(`/read?paper=${result.id}`); return; }
      for (let attempt = 0; attempt < 120; attempt++) {
        const paper = await apiJson<Paper>(`/api/papers/${result.id}`);
        if (paper.status === "parsed") { router.push(`/read?paper=${result.id}`); return; }
        if (paper.status === "failed") throw new Error("开放 PDF 下载成功，但解析失败。请手动上传可读 PDF。");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("PDF 仍在解析，请稍后从论文库打开");
    } catch (e) { setError(e instanceof Error ? e.message : "开放 PDF 暂时不可用，请手动上传"); }
    finally { setBusy(false); }
  }

  function workCard(work: Work, compact = false) {
    const paper = saved.find((item) => item.openalex_id === work.openalex_id);
    const acting = pendingWorkId === work.openalex_id;
    return <article key={work.openalex_id} className={`workCard ${compact ? "compact" : ""}`}>
      <div className="workMeta"><span>{domains[work.domain || ""] || "跨学科"}</span><span>{work.year || "年份未知"}</span><span>{work.journal || "来源未知"}</span><span>被引 {work.citation_count}</span><span className={`workAccess ${paper?.status === "parsed" ? "fulltext" : ""}`}>{paper?.status === "parsed" ? "已有全文" : "尚无全文"}</span>{acting && <span className="workPending" role="status">正在处理…</span>}</div>
      <h3>{work.title}</h3><p className="workAuthors">{work.authors.slice(0, 4).join(" · ") || "作者未提供"}</p>
      {work.abstract && <p className="workAbstract">{work.abstract}</p>}
      <div className="workPrimaryActions"><button onClick={() => showGraph(work.openalex_id)} disabled={busy || !!pendingWorkId}>浏览文献关系 <span>↗</span></button>{paper?.status === "parsed" ? <Link href={`/read?paper=${paper.id}`}>打开全文精读 <span>→</span></Link> : <label>上传 PDF 精读 <span>→</span><input type="file" accept=".pdf,application/pdf" hidden onChange={(e) => upload(work, e)} disabled={busy} /></label>}</div>
      <details className="workMore"><summary>保存、对比与其他操作 <span>＋</span></summary><div className="workActions"><button onClick={() => runWorkAction(work.openalex_id, () => setCore(work))} disabled={busy || !!pendingWorkId}>设为研究中心</button><button onClick={() => runWorkAction(work.openalex_id, () => addToCompare(work))} disabled={busy || !!pendingWorkId}>{workspace?.selected_paper_ids.includes(paper?.id || "") ? "已加入对比" : "加入对比"}</button>{paper ? <span className="workSaved">已存入论文库</span> : <button onClick={() => runWorkAction(work.openalex_id, () => save(work))} disabled={busy || !!pendingWorkId}>保存检索记录</button>}{work.oa_pdf_url && paper?.status !== "parsed" && <button onClick={() => importOpenPdf(work)} disabled={busy}>尝试获取开放 PDF</button>}</div></details>
      {paper?.status !== "parsed" && <small className="evidenceNote">当前仅展示检索信息与可用摘要；逐页精读需先取得全文。</small>}
    </article>;
  }

  return <><ResearchNav current="/discover" /><main className="researchPage">
    <div className="pageIntro"><div className="eyebrow">01 / DISCOVER</div><h1>从一个问题，找到值得深读的论文。</h1><p>自然语言检索 OpenAlex；先看研究关系，再决定哪些论文需要全文精读。</p></div>
    <form className="searchBox" onSubmit={(e) => { e.preventDefault(); search(1); }}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例如：单细胞测序如何揭示肿瘤耐药机制？" aria-label="论文检索" /><button disabled={busy || !query.trim()}>{busy ? "检索中…" : "检索论文 ↗"}</button></form>
    <div className="searchModes"><button className={mode === "semantic" ? "active" : ""} onClick={() => { searchVersion.current++; setMode("semantic"); setResult({ items: [], count: 0, page: 0, mode: "semantic" }); }}>语义检索</button><button className={mode === "keyword" ? "active" : ""} onClick={() => { searchVersion.current++; setMode("keyword"); setResult({ items: [], count: 0, page: 0, mode: "keyword" }); }}>关键词检索</button><span>语义检索最多展示 50 篇；关键词检索适合精确题名。</span></div>
    {!result.items.length && <div className="suggestions">试试：{["single cell RNA sequencing cancer", "transformer model efficiency", "perovskite solar cell stability", "education policy regression"].map((term) => <button key={term} onClick={() => { setQuery(term); search(1, term); }}>{term}</button>)}</div>}
    {error && <div className="researchError" role="alert">{error}</div>}
    {busy && !loadingGraph && <StepLoading title={busyLabel || "正在处理"} steps={busyLabel.includes("检索") ? ["理解检索词", "查询 OpenAlex 或本地缓存", "整理论文信息与关系"] : ["保留论文记录", "提取全文与页码", "建立可核验的精读目录"]} />}
    {result.page === 0 && !busy && !error && <div className="discoverStarter"><div><span className="sectionLabel">HOW IT WORKS</span><h2>先检索，再决定读哪篇</h2><p>输入研究问题后，先查看摘要和论文关系；找到相关文献，再获取或上传 PDF 进入全文精读。</p></div><ol><li><b>01</b><span>检索主题</span></li><li><b>02</b><span>查看论文关系</span></li><li><b>03</b><span>取得 PDF 后精读</span></li></ol></div>}
    {!!result.items.length && <><div className="resultBar"><div><strong>{result.count.toLocaleString()}</strong> 条相关记录 <span>· 当前展示 {result.items.length} 篇</span>{result.cached && <small className="cacheStamp"> · 缓存结果{result.fetched_at ? ` · ${new Date(result.fetched_at).toLocaleString("zh-CN")}` : ""}{result.stale ? " · 当前网络不可用" : ""}</small>}</div><div className="tabBar"><button disabled={busy} onClick={() => search(1, query, true)}>刷新结果</button><button className={tab === "list" ? "active" : ""} onClick={() => setTab("list")}>列表</button><button className={tab === "graph" ? "active" : ""} onClick={() => { setTab("graph"); if (!graph) showGraph(result.items[0].openalex_id); }}>关系图谱</button></div></div>
      {tab === "list" ? <><div className="workList">{result.items.map((work) => workCard(work))}</div><button className="moreButton" disabled={busy || result.items.length >= result.count} onClick={() => search(result.page + 1)}>{busy ? "加载中…" : "加载更多论文"}</button></> :
      <div className="graphLayout"><div className="graphRegion">{graph?.cached && <p className="graphInstruction">缓存图谱 · {graph.fetched_at ? new Date(graph.fetched_at).toLocaleString("zh-CN") : ""}</p>}{graph && <CitationGraph works={graph.nodes} links={graph.links} center={center} selectedId={selected?.openalex_id} onSelect={(id) => { const work = graph.nodes.find((item) => item.openalex_id === id); if (work) setSelected(work); }} />}{loadingGraph && <div className="graphLoading" role="status"><div className="graphLoadingTrack"><i /></div><span>正在切换中心论文</span><strong>{graph?.nodes.find((item) => item.openalex_id === pendingCenter)?.title || result.items.find((item) => item.openalex_id === pendingCenter)?.title || "正在读取文献关系"}</strong><small>保留当前视图，关系数据就绪后展开新图谱</small></div>}</div><aside className="graphAside" key={center}>{selected ? <><div className="relationSummary"><strong>与中心论文的关系</strong><p>{selected.openalex_id === center ? "当前中心论文" : graph?.links.find((item) => item.target === selected.openalex_id)?.relation === "references" ? "当前论文的参考文献；关系来自 OpenAlex 引用元数据。" : "OpenAlex 标记的相关研究；具体研究重合点需查看摘要或原文。"}</p></div>{workCard(selected, true)}<button className="moreButton" onClick={() => showGraph(selected.openalex_id)} disabled={busy || selected.openalex_id === center}>{busy ? "正在展开…" : selected.openalex_id === center ? "当前中心论文" : "以这篇论文为中心展开 →"}</button></> : <p>选择一篇论文查看摘要与可用操作。</p>}</aside></div>}
    </>}
    {!!workspace?.selected_paper_ids.length && <div className="compareTray"><strong>待综合 · {workspace.selected_paper_ids.length} / 5</strong><div>{workspace.selected_paper_ids.map((id) => <span key={id} title={saved.find((item) => item.id === id)?.title || "已选论文"}>{saved.find((item) => item.id === id)?.title || "已选论文"}<button title="移出待综合论文" aria-label={`移出 ${saved.find((item) => item.id === id)?.title || "论文"}`} onClick={() => updateWorkspace({selected_paper_ids: workspace.selected_paper_ids.filter((item) => item !== id)}).catch((e) => setError(e.message))}>×</button></span>)}</div><Link href="/synthesis">开始综合 →</Link></div>}
  </main></>;
}
