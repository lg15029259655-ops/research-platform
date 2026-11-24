"use client";

import { useEffect, useRef, useState } from "react";
import PageMain from "@/components/PageMain";
import { deferredPanel } from "@/components/deferred-panel";
import type { LineageResponse, LineageWork } from "@/components/lineage/lineageLayout";
import { apiJson } from "@/lib/api";
import { tabGroup } from "@/lib/tabs";
import prepared from "./discovery.json";
import "./prepared.css";

const LineageGraph = deferredPanel(() => import("@/components/lineage/LineageGraph"), "三维谱系图");
const savedLineage = prepared.lineage as LineageResponse;
type Search = { items: LineageWork[]; count: number };
const views = ["list", "lineage"] as const;
type View = (typeof views)[number];

export default function PreparedDiscovery() {
  const [query, setQuery] = useState(prepared.query);
  const [result, setResult] = useState<Search>(prepared.search);
  const [view, setView] = useState<View>("list");
  const [lineage, setLineage] = useState(savedLineage);
  const [selectedId, setSelectedId] = useState(savedLineage.center.openalex_id);
  const [searching, setSearching] = useState(false);
  const [loadingLineage, setLoadingLineage] = useState(false);
  const [error, setError] = useState("");
  const searchRequest = useRef<AbortController | null>(null);
  const lineageRequest = useRef<AbortController | null>(null);
  const tabs = tabGroup(views, view, setView);
  const selected = lineage.nodes.find((node) => node.openalex_id === selectedId) ?? lineage.center;

  useEffect(() => {
    const term = new URLSearchParams(window.location.search).get("q");
    if (term && term !== prepared.query) {
      setQuery(term);
      void search(term);
    }
    return () => {
      searchRequest.current?.abort();
      lineageRequest.current?.abort();
    };
  }, []);

  async function search(term: string) {
    if (!term.trim()) return;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true); setError(""); setView("list");
    try {
      const next = term.trim() === prepared.query ? prepared.search
        : await apiJson<Search>(`/api/research/discover?${new URLSearchParams({ q: term.trim(), mode: "semantic" })}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]),
        });
      if (controller.signal.aborted) return;
      setResult(next);
      window.history.replaceState(null, "", `/discover?q=${encodeURIComponent(term.trim())}`);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "暂时无法检索，请重试。");
    } finally {
      if (searchRequest.current === controller && !controller.signal.aborted) setSearching(false);
    }
  }

  async function showLineage(id: string) {
    setView("lineage"); LineageGraph.preload();
    lineageRequest.current?.abort();
    setError("");
    if (id === savedLineage.center.openalex_id || id === lineage.center.openalex_id) {
      if (id === savedLineage.center.openalex_id) setLineage(savedLineage);
      setSelectedId(id); setLoadingLineage(false);
      return;
    }
    const controller = new AbortController();
    lineageRequest.current = controller;
    setLoadingLineage(true);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]);
      let next: LineageResponse;
      if (prepared.preparedLineages.includes(id)) {
        const response = await fetch(`/prepared-discovery/${encodeURIComponent(id)}.json`, { signal });
        if (!response.ok) throw new Error("暂时无法读取已保存的谱系。");
        next = await response.json() as LineageResponse;
      } else {
        next = await apiJson<LineageResponse>(`/api/research/lineage/${encodeURIComponent(id)}`, { signal });
      }
      if (!controller.signal.aborted) { setLineage(next); setSelectedId(next.center.openalex_id); }
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "暂时无法读取该论文的谱系。");
    } finally {
      if (lineageRequest.current === controller && !controller.signal.aborted) setLoadingLineage(false);
    }
  }

  return <PageMain route="/discover" className="researchPage">
    <div className="pageIntro"><h1>科研发现</h1></div>
    <form className="searchBox" onSubmit={(event) => { event.preventDefault(); void search(query); }}>
      <input aria-label="论文检索" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button disabled={searching || !query.trim()}>{searching ? "检索中…" : "检索论文 ↗"}</button>
    </form>
    {error && <p className="researchError" role="alert">{error}</p>}
    <div className="resultBar"><strong>当前展示 {result.items.length} 篇</strong>
      <div className="tabBar" {...tabs.list} aria-label="结果视图">
        <button {...tabs.item("list")}>列表</button>
        <button {...tabs.item("lineage", () => void showLineage(result === prepared.search
          ? savedLineage.center.openalex_id : result.items[0]?.openalex_id ?? savedLineage.center.openalex_id))}>文献谱系</button>
      </div>
    </div>
    {view === "list" ? <div className="workList">
      {result.items.map((work) => <details className="sectionBox" key={work.openalex_id}>
        <summary><strong>{work.title}</strong> {work.year && <small> · {work.year}</small>}</summary>
        {work.abstract && <p>{work.abstract}</p>}
        <div className="actionRow"><a className="inlineLink" href={`https://openalex.org/${encodeURIComponent(work.openalex_id)}`} target="_blank" rel="noopener noreferrer">打开文献来源 ↗</a>
          <button className="quietButton" type="button" onClick={() => void showLineage(work.openalex_id)}>查看谱系</button></div>
      </details>)}
      {!result.items.length && <p>没有找到相关文献。</p>}
    </div> : <section className="sectionBox">
      <h2>文献谱系</h2><p>{lineage.center.title} · {lineage.nodes.length} 篇文献 · {lineage.edges.length} 条联系</p>
      <LineageGraph data={lineage} selectedId={selectedId} onSelect={setSelectedId} onRecenter={(id) => void showLineage(id)} loading={loadingLineage} />
      <h3>{selected.title}</h3>{selected.abstract && <p>{selected.abstract}</p>}
    </section>}
  </PageMain>;
}
