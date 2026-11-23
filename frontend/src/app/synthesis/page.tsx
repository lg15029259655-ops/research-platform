"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import JobProgress from "@/components/jobs/JobProgress";
import { ApiError, apiJson } from "@/lib/api";
import { useWorkspaceJob } from "@/lib/workspace-jobs";
import { setPaperInSynthesis, updateWorkspace, useWorkspace } from "@/lib/workspace";
import { tabGroup } from "@/lib/tabs";
import EvidenceMap, { type Claim } from "@/components/EvidenceMap";
import GapPath from "@/components/GapPath";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import SavedHistory from "@/components/SavedHistory";

type Paper = { id: string; title: string; status: string; domain: string | null; year: number | null; warning?: string | null };
type Cell = { paper_id: string; value: string; source: string };
type Comparison = { papers: { paper_id: string; title: string }[]; dimensions: { name: string; values: Cell[] }[];
  consensus: string[]; differences: string[]; controversies: Claim[];
  gaps: string[]; questions: string[]; next_steps: string[]; extraction_warnings?: string[]; stale_after_reparse?: boolean };
type Artifact = { id: string; payload: Comparison; paper_ids: string[]; created_at: string };
type SavedComparison = { id: string; created_at: string; paper_count: number; titles: string[] };

export default function SynthesisPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view");
  const sourceArtifact = searchParams.get("artifact");
  const tab = view === "evidence" || view === "gaps" ? view : "matrix";
  const [papers, setPapers] = useState<Paper[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [pendingChoices, setPendingChoices] = useState<Record<string, boolean>>({});
  const [selectionError, setSelectionError] = useState("");
  const [loadedArtifact, setArtifact] = useState<Artifact | null>(null);
  const [artifactError, setArtifactError] = useState("");
  const [artifactAttempt, setArtifactAttempt] = useState(0);
  const [showSelection, setShowSelection] = useState(true);
  const [handoffPending, setHandoffPending] = useState(false);
  const handoff = useRef<AbortController | null>(null);
  const { job, start, cancel, dismiss } = useWorkspaceJob("synthesis");
  const busy = job?.status === "running";
  const [error, setError] = useState("");
  const [taskCanceled, setTaskCanceled] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{cell: Cell; dimension: string} | null>(null);
  const [activeDimension, setActiveDimension] = useState(0);
  const resultRef = useRef<HTMLElement>(null);
  const selectionRef = useRef<HTMLElement>(null);
  const focusNewResult = useRef(false);
  const { workspace, workspaceError, refresh } = useWorkspace();
  function setTab(next: "matrix" | "evidence" | "gaps") {
    const params = new URLSearchParams(window.location.search);
    if (next === "matrix") params.delete("view"); else params.set("view", next);
    window.history.replaceState(null, "", params.size ? `/synthesis?${params}` : "/synthesis");
  }
  const resultTabs = tabGroup(["matrix", "evidence", "gaps"] as const, tab, setTab);
  useEffect(() => () => { handoff.current?.abort(); }, []);
  async function loadPapers(signal?: AbortSignal) {
    setLibraryError(false);
    try { setPapers(await apiJson<Paper[]>("/api/papers", { signal })); }
    catch { if (!signal?.aborted) setLibraryError(true); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void loadPapers(controller.signal);
    return () => controller.abort();
  }, []);
  const artifactId = sourceArtifact || workspace?.synthesis_id;
  const artifact = loadedArtifact?.id === artifactId ? loadedArtifact : null;
  useEffect(() => {
    setSelectedCell(null);
    setActiveDimension(0);
  }, [artifactId]);
  useEffect(() => {
    setArtifactError("");
    if (!artifactId) { if (workspace) setArtifact(null); return; }
    const controller = new AbortController();
    apiJson<Artifact[]>(`/api/research/artifacts?kind=paper_compare&artifact_id=${artifactId}`, { signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return;
        const saved = items.find((item) => item.id === artifactId);
        if (saved) setArtifact(saved);
        else setArtifactError("找不到已保存的综合结果");
      })
      .catch(() => { if (!controller.signal.aborted) setArtifactError("暂时无法读取已保存的综合结果"); });
    return () => controller.abort();
  }, [artifactId, !!workspace, artifactAttempt]);
  const fulltext = (papers || []).filter((paper) => paper.status === "parsed");
  const savedSelection = workspace?.selected_paper_ids ?? [];
  const missingPapers = papers ? savedSelection.filter((id) => !papers.some((paper) => paper.id === id)).join(",") : "";
  useEffect(() => {
    if (!missingPapers) return;
    const controller = new AbortController();
    void loadPapers(controller.signal);
    return () => controller.abort();
  }, [missingPapers]);
  const selected = savedSelection.filter((id) => fulltext.some((paper) => paper.id === id));
  const awaitingFulltext = savedSelection.filter((id) => !selected.includes(id));
  const savingSelection = Object.keys(pendingChoices).length > 0;
  async function changeChoice(id: string, checked: boolean) {
    if (!workspace || pendingChoices[id] !== undefined) return;
    setSelectionError("");
    setPendingChoices((current) => ({ ...current, [id]: checked }));
    setShowSelection(true);
    try {
      await setPaperInSynthesis(id, checked, workspace.query);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "暂时无法连接服务，可以重试";
      setSelectionError(`论文选择未确认保存。${message}`);
      await refresh(true).catch(() => {});
    } finally {
      setPendingChoices(({ [id]: _, ...rest }) => rest);
    }
  }
  function compare() {
    if (busy || savingSelection || selected.length < 2) return;
    if (!sourceArtifact && artifact && !artifact.payload.stale_after_reparse && artifact.paper_ids.slice().sort().join("|") === selected.slice().sort().join("|")) {
      setShowSelection(false); setTab("matrix"); resultRef.current?.scrollIntoView({block: "start"}); return;
    }
    setError("");
    setTaskCanceled(false);
    if (sourceArtifact) window.history.replaceState(null, "", "/synthesis");
    void start("compare", { paper_ids: selected });
  }
  useEffect(() => {
    if (!job || job.status === "running") return;
    if (job.status === "canceled") setTaskCanceled(true);
    const result = job.result as Artifact | null;
    if (job.status !== "done" || !result?.payload) {
      dismiss(job);
      if (job.status !== "canceled") setError(job.error || "综合分析未完成，请重试");
      return;
    }
    let disposed = false;
    void refresh(true).then((current) => {
      if (disposed) return;
      if (current.synthesis_id !== result.id) {
        setError("后台综合已完成，当前工作区已切换到其他内容。");
        return;
      }
      if (new URLSearchParams(window.location.search).has("artifact")) return;
      focusNewResult.current = true;
      setArtifact(result); setActiveDimension(0); setShowSelection(false);
      window.history.replaceState(null, "", "/synthesis");
    }).catch(() => {
      if (!disposed) setError("综合结果已保存，请重新打开本页读取。");
    }).finally(() => { if (!disposed) dismiss(job); });
    return () => { disposed = true; };
  }, [job, dismiss, refresh]);
  async function useQuestion(question: string) {
    if (handoff.current || !artifact) return;
    const controller = new AbortController();
    handoff.current = controller;
    setHandoffPending(true); setError("");
    try {
      const current = workspace ?? await refresh();
      const sourceIds = artifact?.paper_ids || [];
      const sameQuestion = current.design_idea === question && current.gap_context.question === question
        && current.gap_context.synthesis_id === artifact.id;
      await updateWorkspace({research_gap: data?.gaps[0] || "", design_idea: question,
        ...(sameQuestion ? {} : { novelty_id: null, design_version_id: null }),
        gap_context: {consensus: data?.consensus || [], disagreements: data?.controversies || [],
          paper_ids: sourceIds, synthesis_id: artifact.id, question}}, current.query);
      if (!controller.signal.aborted) router.push("/design");
    } catch (e) { setError(e instanceof Error ? e.message : "无法带入研究问题"); }
    finally { handoff.current = null; setHandoffPending(false); }
  }
  const data = artifact?.payload;
  const selectionChanged = !sourceArtifact && !!artifact && artifact.paper_ids.slice().sort().join("|") !== selected.slice().sort().join("|");
  useEffect(() => { if (artifact?.id) setShowSelection(false); }, [artifact?.id]);
  useEffect(() => {
    if (data && (focusNewResult.current || sourceArtifact)) {
      focusNewResult.current = false;
      if (sourceArtifact) resultRef.current?.focus({ preventScroll: true });
      resultRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  }, [data, sourceArtifact]);
  const label = (id: string) => papers?.find((paper) => paper.id === id)?.title || data?.papers.find((paper) => paper.paper_id === id)?.title || "论文";
  const libraryReady = !!papers && !!workspace;
  const loadingArtifact = !!artifactId && artifact?.id !== artifactId && !artifactError;
  const displayFinding = (value: string) => artifact?.paper_ids.reduce((text, id, index) => text.replaceAll(id, `「论文 ${String(index + 1).padStart(2, "0")}」`), value) || value;
  function reviseSelection() {
    setShowSelection(true);
    selectionRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
  return <main id="main" className="researchPage">
    <div className="pageIntro"><div className="eyebrow">03 / SYNTHESIZE</div><h1>把多篇论文放在同一张证据桌上。</h1><p>选取 2–5 篇已有可解析 PDF 的论文，比较研究问题、方法、结论与证据边界。</p></div>
    <SavedHistory<SavedComparison> title="综合历史" endpoint="/api/research/comparisons" currentId={workspace?.synthesis_id} viewingId={artifactId} scroll={false}
      href={(entry) => `/synthesis?artifact=${encodeURIComponent(entry.id)}`}
      label={(entry) => entry.titles.length ? entry.titles.join(" · ") : `${entry.paper_count} 篇论文的综合`}
      metadata={(entry) => `${entry.paper_count} 篇论文`} />
    {sourceArtifact && <p className="workspaceLoading">正在查看已保存的综合。 <Link className="inlineLink" href="/synthesis">返回当前综合</Link></p>}
    <section className="sectionBox" ref={selectionRef}><div className="selectionHeading"><h2>选择论文 <small> {selected.length} / 5</small></h2>{data && <button className="quietButton" onClick={() => setShowSelection((open) => !open)}>{showSelection ? "收起论文列表" : "更换对比论文"}</button>}</div>
      {data && !showSelection && <p className="selectionSummary">当前综合基于 {artifact?.paper_ids.length} 篇 PDF 提取的片段；不代表每篇都已完整解析。</p>}
      {showSelection && !libraryReady && <p className="workspaceLoading" role="status">{libraryError ? <button className="quietButton" onClick={() => void loadPapers()}>重试读取论文库</button> : (workspaceError && !workspace) ? "请先重试读取工作区" : "正在读取论文与已选列表…"}</p>}
      {showSelection && libraryReady && <>
        {fulltext.length ? <div className="selectionList">
          {fulltext.map((paper) => <label key={paper.id}>
            <input type="checkbox" checked={pendingChoices[paper.id] ?? selected.includes(paper.id)}
              onChange={(event) => void changeChoice(paper.id, event.target.checked)}
              disabled={pendingChoices[paper.id] !== undefined} />
            <span>{paper.title}<small>{paper.domain || "领域待识别"} · 已有 PDF，提取质量需核对</small></span>
          </label>)}
        </div> : <p>论文库中尚无已解析的 PDF。先去 <Link href="/read" className="inlineLink">上传 PDF</Link>。</p>}
        {!!awaitingFulltext.length && <div className="selectionSummary">
          <p>以下已选论文尚无可综合的全文，仍占用待综合名额。</p>
          <ul>{awaitingFulltext.map((id) => <li key={id}>
            {papers?.find((paper) => paper.id === id)?.title || "论文暂不可用"}
            <button type="button" className="quietButton" disabled={pendingChoices[id] !== undefined}
              onClick={() => void changeChoice(id, false)}>移出待综合</button>
          </li>)}</ul>
        </div>}
      </>}
      {selectionError && <div className="researchError" role="alert">{selectionError}</div>}
      {savingSelection && <p className="workspaceLoading" role="status">正在保存论文选择…</p>}
      {libraryReady && selectionChanged && <p className="selectionChanged" role="status">论文选择已改变。下方保留的是上一次综合结果；重新生成后才会反映当前选择。</p>}
      {showSelection && libraryReady && <button className="primaryButton" onClick={compare}
        disabled={busy || savingSelection || selected.length < 2} aria-busy={busy || savingSelection}>
        {busy ? "正在组织证据…" : selectionChanged ? "按当前选择重新综合 ↗" : "生成对比与研究空白 ↗"}
      </button>}
    </section>
    {!data && !loadingArtifact && libraryReady && fulltext.length < 2 && !busy && <section className="startGuide" aria-label="文献综合使用引导"><div className="startGuideIntro"><span>BEFORE YOU COMPARE</span><h2>两篇全文，是证据对照的起点。</h2><p>当前只有摘要的记录不会参与全文综合。先上传至少两篇 PDF，系统才会比较方法、结果与研究空白。</p><Link className="guideLink" href="/read">前往论文库上传 PDF →</Link></div></section>}
    {error && <div className="researchError" role="alert">{error}</div>}
    {taskCanceled && <p className="workspaceLoading" role="status">任务已取消。</p>}
    {/* 阶段文案以服务端为准；可取消，也可以离开本页——任务在服务端继续，回来还能看到结果。 */}
    <JobProgress variant="fixed" title="正在综合全文证据" stageLabel={job?.stage} progress={job?.progress} startedAt={busy ? job.startedAt : null} onCancel={cancel} cancelPending={job?.cancelPending} cancelError={job?.cancelError} reconnecting={job?.reconnecting} />
    {loadingArtifact && <p className="workspaceLoading" role="status">正在打开上次综合结果…</p>}
    {artifactError && <div className="researchError" role="alert">{artifactError} <button className="quietButton" onClick={() => setArtifactAttempt((count) => count + 1)}>重试</button></div>}
    {data && <section className="sectionBox synthesisResult" ref={resultRef} tabIndex={-1} aria-label="综合结果"><div className="resultBar"><div><strong>综合结果</strong>{selectionChanged && <b className="resultVersion">上一次选择</b>}<span> · 根据上传 PDF 提取的文字生成，请与原文核对</span></div><div className="tabBar" {...resultTabs.list} aria-label="综合结果视图"><button {...resultTabs.item("matrix")}>论文对比</button><button {...resultTabs.item("evidence")}>证据关系</button><button {...resultTabs.item("gaps")}>研究空白</button></div></div>
      {data.extraction_warnings?.map((warning) => <p className="miniNotice" role="note" key={warning}>{warning}</p>)}
      {data.stale_after_reparse && <p className="miniNotice" role="note">部分论文已重新识别，当前为旧版综合结果，引用位置可能已变化，请重新综合并核对原文。</p>}
      {!data.extraction_warnings && artifact?.paper_ids.map((id) => papers?.find((paper) => paper.id === id)).filter((paper) => paper?.warning).map((paper) => <p className="miniNotice" role="note" key={paper!.id}>《{paper!.title}》：{paper!.warning} 请核对综合结果与原文。</p>)}
      {tab === "matrix" && <>
        <div className="compareFocus">
          <nav className="compareDimensions" aria-label="选择对比维度"><span>COMPARISON INDEX</span><strong>{data.dimensions.length} 个对比维度</strong>{data.dimensions.map((row, index) => <button key={`${row.name}-${index}`} type="button" className={activeDimension === index ? "active" : ""} aria-current={activeDimension === index ? "true" : undefined} onClick={() => setActiveDimension(index)}><b>{String(index + 1).padStart(2, "0")}</b><span>{row.name}</span><i>↗</i></button>)}</nav>
          <div className="compareFocusBody">{data.dimensions.length ? <><header><div><span>DIMENSION {String(Math.min(activeDimension + 1, data.dimensions.length)).padStart(2, "0")}</span><h3>{data.dimensions[Math.min(activeDimension, data.dimensions.length - 1)].name}</h3></div></header><div className="comparePaperGrid">{artifact?.paper_ids.map((id, index) => { const row = data.dimensions[Math.min(activeDimension, data.dimensions.length - 1)]; const cell = row.values.find((item) => item.paper_id === id); return <button key={id} className="comparePaper" type="button" disabled={!cell} onClick={() => cell && setSelectedCell({cell, dimension: row.name})}><span className="comparePaperTop"><b>{String(index + 1).padStart(2, "0")}</b><small>PAPER</small><i>↗</i></span><strong title={label(id)}>{label(id)}</strong><span className="comparePaperExcerpt">{cell?.value || "该维度尚未提取到证据"}</span><span className="comparePaperAction">{cell ? "查看完整分析与来源" : "暂无内容"} <i>↗</i></span></button>; })}</div></> : <p className="compareEmpty">本次综合没有生成可比较的维度，请更换论文后重新生成。</p>}</div>
        </div>
        <div className="compareTakeaways"><section><span>SHARED SIGNAL</span><h3>共同点</h3><p>{displayFinding(data.consensus[0] || "当前资料尚未形成可核对的共同结论。")}</p>{data.consensus.length > 0 && <details><summary>查看全部 {data.consensus.length} 条</summary><ul>{data.consensus.map((item, i) => <li key={i}>{displayFinding(item)}</li>)}</ul></details>}</section><section><span>WHERE THEY DIFFER</span><h3>关键差异</h3><p>{displayFinding(data.differences[0] || "当前资料尚未形成可核对的差异结论。")}</p>{data.differences.length > 0 && <details><summary>查看全部 {data.differences.length} 条</summary><ul>{data.differences.map((item, i) => <li key={i}>{displayFinding(item)}</li>)}</ul></details>}</section></div>
      </>}
      {tab === "evidence" && <EvidenceMap claims={data.controversies} papers={data.papers} onReviseSelection={reviseSelection} />}
      {tab === "gaps" && <GapPath key={artifactId} data={data} onUseQuestion={useQuestion} handoffPending={handoffPending} />}
    </section>}
    {selectedCell && <EvidenceDrawer title={selectedCell.dimension} eyebrow={label(selectedCell.cell.paper_id)} onClose={() => setSelectedCell(null)}><p>{selectedCell.cell.value || "未提取到证据"}</p><p className="miniNotice">此单元格是综合分析的概述，请核对原文；来源标记不能代替可点击的原文定位。</p>{selectedCell.cell.source && <dl><dt>来源标记</dt><dd>{selectedCell.cell.source}</dd></dl>}<Link className="drawerAction" href={`/read?paper=${selectedCell.cell.paper_id}`}>打开论文核对 ↗</Link></EvidenceDrawer>}
  </main>;
}
