"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ResearchNav from "@/components/ResearchNav";
import JobProgress from "@/components/jobs/JobProgress";
import { apiJson } from "@/lib/api";
import { submitJob, watchJob, type JobProgress as JobProgressData } from "@/lib/jobs";
import { updateWorkspace, useWorkspace } from "@/lib/workspace";
import { tabGroup } from "@/lib/tabs";
import EvidenceMap, { type Claim } from "@/components/EvidenceMap";
import GapPath from "@/components/GapPath";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import "../research.css";
import "../studio.css";

type Paper = { id: string; title: string; status: string; domain: string | null; year: number | null; warning?: string | null };
type Cell = { paper_id: string; value: string; source: string };
type Comparison = { papers: { paper_id: string; title: string }[]; dimensions: { name: string; values: Cell[] }[];
  consensus: string[]; differences: string[]; controversies: Claim[];
  gaps: string[]; questions: string[]; next_steps: string[]; extraction_warnings?: string[]; stale_after_reparse?: boolean };
type Artifact = { id: string; payload: Comparison; paper_ids: string[]; created_at: string };

export default function SynthesisPage() {
  const router = useRouter();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [showSelection, setShowSelection] = useState(true);
  const [tab, setTab] = useState<"matrix" | "evidence" | "gaps">("matrix");
  const [busy, setBusy] = useState(false);
  // 慢任务改成后台 job：阶段与进度来自 SSE，开始时间交给 JobProgress 自己算"已等待 N 秒"。
  const [jobStage, setJobStage] = useState("");
  const [jobProgress, setJobProgress] = useState<JobProgressData | null>(null);
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const compareAbort = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [selectedCell, setSelectedCell] = useState<{cell: Cell; dimension: string} | null>(null);
  const [activeDimension, setActiveDimension] = useState(0);
  const resultRef = useRef<HTMLElement>(null);
  const selectionRef = useRef<HTMLElement>(null);
  const focusNewResult = useRef(false);
  const selectionWrites = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSelections = useRef(0);
  const { workspace, refresh } = useWorkspace();
  const resultTabs = tabGroup(["matrix", "evidence", "gaps"] as const, tab, setTab);
  // 离开页面时取消后台综合任务：用户不会再回来看的任务不该继续占用模型配额。
  useEffect(() => () => { compareAbort.current?.abort(); }, []);
  useEffect(() => {
    apiJson<Paper[]>("/api/papers").then(setPapers).catch(() => setError("无法读取论文库"));
  }, []);
  useEffect(() => {
    if (!workspace) return;
    if (!workspace.synthesis_id) { setArtifact(null); return; }
    apiJson<Artifact[]>(`/api/research/artifacts?kind=paper_compare&artifact_id=${workspace.synthesis_id}`)
      .then((items) => setArtifact(items.find((item) => item.id === workspace.synthesis_id) || null))
      .catch(() => setArtifact(null));
  }, [workspace?.synthesis_id]);
  const fulltext = papers.filter((paper) => paper.status === "parsed");
  useEffect(() => {
    if (workspace && papers.length && pendingSelections.current === 0) setSelected(workspace.selected_paper_ids.filter((id) => papers.some((paper) => paper.id === id && paper.status === "parsed")));
  }, [workspace?.selected_paper_ids.join(","), papers]);
  function toggle(id: string) {
    // 原来是超限就静默 no-op（selected.length < 5 ? … : selected），点了没反应也没提示。
    if (!selected.includes(id) && selected.length >= 5) { setError("对比篮最多 5 篇论文，请先移除一篇"); return; }
    const updated = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    setError("");
    setSelected(updated);
    setShowSelection(true);
    pendingSelections.current += 1;
    selectionWrites.current = selectionWrites.current.catch(() => {}).then(() => updateWorkspace({selected_paper_ids: updated})).finally(() => { pendingSelections.current -= 1; });
    selectionWrites.current.catch((e) => setError(e.message));
  }
  async function compare() {
    if (artifact && !artifact.payload.stale_after_reparse && artifact.paper_ids.slice().sort().join("|") === selected.slice().sort().join("|")) {
      setShowSelection(false); setTab("matrix"); resultRef.current?.scrollIntoView({block: "start"}); return;
    }
    // 连点会各自建任务；先取消上一次再提交，避免两个结果互相覆盖。
    compareAbort.current?.abort();
    const controller = new AbortController();
    compareAbort.current = controller;
    setBusy(true); setError(""); setJobStage("正在提交综合任务"); setJobStartedAt(Date.now()); setJobProgress(null);
    try {
      await selectionWrites.current;
      const job = await submitJob("compare", { paper_ids: selected });
      const snapshot = await watchJob(job.id, {
        onStage: (_stage, label) => setJobStage(label),
        onProgress: (progress) => setJobProgress(progress),
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (snapshot.status !== "done") throw new Error(snapshot.error?.message || "综合分析未完成，请重试");
      const result = snapshot.result as Artifact | null;
      if (!result?.payload) throw new Error("综合分析没有返回可用结果");
      focusNewResult.current = true;
      setArtifact(result); setActiveDimension(0); setShowSelection(false); setTab("matrix");
      await refresh();
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "综合分析失败");
    } finally {
      if (compareAbort.current === controller) {
        compareAbort.current = null; setBusy(false); setJobStartedAt(null); setJobProgress(null); setJobStage("");
      }
    }
  }
  async function useQuestion(question: string) {
    try {
      await updateWorkspace({research_gap: data?.gaps[0] || "", design_idea: question,
        novelty_id: null, design_version_id: null,
        gap_context: {consensus: data?.consensus || [], disagreements: data?.controversies || [],
          paper_ids: artifact?.paper_ids || [], question}});
      router.push("/design");
    } catch (e) { setError(e instanceof Error ? e.message : "无法带入研究问题"); }
  }
  const data = artifact?.payload;
  const selectionChanged = !!artifact && artifact.paper_ids.slice().sort().join("|") !== selected.slice().sort().join("|");
  useEffect(() => { if (artifact?.id) setShowSelection(false); }, [artifact?.id]);
  useEffect(() => {
    if (data && focusNewResult.current) {
      focusNewResult.current = false;
      resultRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  }, [data]);
  const label = (id: string) => papers.find((paper) => paper.id === id)?.title || data?.papers.find((paper) => paper.paper_id === id)?.title || "论文";
  const displayFinding = (value: string) => artifact?.paper_ids.reduce((text, id, index) => text.replaceAll(id, `「论文 ${String(index + 1).padStart(2, "0")}」`), value) || value;
  function reviseSelection() {
    setShowSelection(true);
    selectionRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
  return <><ResearchNav current="/synthesis" /><main id="main" className="researchPage">
    <div className="pageIntro"><div className="eyebrow">03 / SYNTHESIZE</div><h1>把多篇论文放在同一张证据桌上。</h1><p>选取 2–5 篇已有可解析 PDF 的论文，比较研究问题、方法、结论与证据边界。</p></div>
    <section className="sectionBox" ref={selectionRef}><div className="selectionHeading"><h2>选择论文 <small> {selected.length} / 5</small></h2>{data && <button className="quietButton" onClick={() => setShowSelection((open) => !open)}>{showSelection ? "收起论文列表" : "更换对比论文"}</button>}</div>
      {data && !showSelection && <p className="selectionSummary">当前综合基于 {artifact?.paper_ids.length} 篇 PDF 提取的片段；不代表每篇都已完整解析。</p>}
      {showSelection && (fulltext.length ? <div className="selectionList">{fulltext.map((paper) => <label key={paper.id}><input type="checkbox" checked={selected.includes(paper.id)} onChange={() => toggle(paper.id)} disabled={!selected.includes(paper.id) && selected.length >= 5} /><span>{paper.title}<small>{paper.domain || "领域待识别"} · 已有 PDF，提取质量需核对</small></span></label>)}</div> : <p>论文库中尚无已解析的 PDF。先去 <Link href="/read" className="inlineLink">上传 PDF</Link>。</p>)}
      {selectionChanged && <p className="selectionChanged" role="status">论文选择已改变。下方保留的是上一次综合结果；重新生成后才会反映当前选择。</p>}
      {showSelection && <button className="primaryButton" onClick={compare} disabled={busy || selected.length < 2} aria-busy={busy}>{busy ? "正在组织证据…" : selectionChanged ? "按当前选择重新综合 ↗" : "生成对比与研究空白 ↗"}</button>}
    </section>
    {!data && fulltext.length < 2 && !busy && <section className="startGuide" aria-label="文献综合使用引导"><div className="startGuideIntro"><span>BEFORE YOU COMPARE</span><h2>两篇全文，是证据对照的起点。</h2><p>当前只有摘要的记录不会参与全文综合。先上传至少两篇 PDF，系统才会比较方法、结果与研究空白。</p><Link className="guideLink" href="/read">前往论文库上传 PDF →</Link></div></section>}
    {error && <div className="researchError" role="alert">{error}</div>}
    {/* 阶段文案以服务端为准；可取消，也可以离开本页——任务在服务端继续，回来还能看到结果。 */}
    <JobProgress variant="fixed" title="正在综合全文证据" stageLabel={jobStage} progress={jobProgress} startedAt={jobStartedAt} onCancel={() => compareAbort.current?.abort()} />
    {data && <section className="sectionBox synthesisResult" ref={resultRef}><div className="resultBar"><div><strong>综合结果</strong>{selectionChanged && <b className="resultVersion">上一次选择</b>}<span> · 根据上传 PDF 提取的文字生成，请与原文核对</span></div><div className="tabBar" {...resultTabs.list} aria-label="综合结果视图"><button {...resultTabs.item("matrix")}>论文对比</button><button {...resultTabs.item("evidence")}>证据关系</button><button {...resultTabs.item("gaps")}>研究空白</button></div></div>
      {data.extraction_warnings?.map((warning) => <p className="miniNotice" role="note" key={warning}>{warning}</p>)}
      {data.stale_after_reparse && <p className="miniNotice" role="note">部分论文已重新识别，当前为旧版综合结果，引用位置可能已变化，请重新综合并核对原文。</p>}
      {!data.extraction_warnings && artifact?.paper_ids.map((id) => papers.find((paper) => paper.id === id)).filter((paper) => paper?.warning).map((paper) => <p className="miniNotice" role="note" key={paper!.id}>《{paper!.title}》：{paper!.warning} 请核对综合结果与原文。</p>)}
      {tab === "matrix" && <>
        <div className="compareFocus">
          <nav className="compareDimensions" aria-label="选择对比维度"><span>COMPARISON INDEX</span><strong>{data.dimensions.length} 个对比维度</strong>{data.dimensions.map((row, index) => <button key={`${row.name}-${index}`} type="button" className={activeDimension === index ? "active" : ""} aria-current={activeDimension === index ? "true" : undefined} onClick={() => setActiveDimension(index)}><b>{String(index + 1).padStart(2, "0")}</b><span>{row.name}</span><i>↗</i></button>)}</nav>
          <div className="compareFocusBody">{data.dimensions.length ? <><header><div><span>DIMENSION {String(Math.min(activeDimension + 1, data.dimensions.length)).padStart(2, "0")}</span><h3>{data.dimensions[Math.min(activeDimension, data.dimensions.length - 1)].name}</h3></div></header><div className="comparePaperGrid">{artifact?.paper_ids.map((id, index) => { const row = data.dimensions[Math.min(activeDimension, data.dimensions.length - 1)]; const cell = row.values.find((item) => item.paper_id === id); return <button key={id} className="comparePaper" type="button" disabled={!cell} onClick={() => cell && setSelectedCell({cell, dimension: row.name})}><span className="comparePaperTop"><b>{String(index + 1).padStart(2, "0")}</b><small>PAPER</small><i>↗</i></span><strong title={label(id)}>{label(id)}</strong><span className="comparePaperExcerpt">{cell?.value || "该维度尚未提取到证据"}</span><span className="comparePaperAction">{cell ? "查看完整分析与来源" : "暂无内容"} <i>↗</i></span></button>; })}</div></> : <p className="compareEmpty">本次综合没有生成可比较的维度，请更换论文后重新生成。</p>}</div>
        </div>
        <div className="compareTakeaways"><section><span>SHARED SIGNAL</span><h3>共同点</h3><p>{displayFinding(data.consensus[0] || "当前资料尚未形成可核对的共同结论。")}</p>{data.consensus.length > 0 && <details><summary>查看全部 {data.consensus.length} 条</summary><ul>{data.consensus.map((item, i) => <li key={i}>{displayFinding(item)}</li>)}</ul></details>}</section><section><span>WHERE THEY DIFFER</span><h3>关键差异</h3><p>{displayFinding(data.differences[0] || "当前资料尚未形成可核对的差异结论。")}</p>{data.differences.length > 0 && <details><summary>查看全部 {data.differences.length} 条</summary><ul>{data.differences.map((item, i) => <li key={i}>{displayFinding(item)}</li>)}</ul></details>}</section></div>
      </>}
      {tab === "evidence" && <EvidenceMap claims={data.controversies} papers={data.papers} onReviseSelection={reviseSelection} />}
      {tab === "gaps" && <GapPath data={data} onUseQuestion={useQuestion} />}
    </section>}
    {selectedCell && <EvidenceDrawer title={selectedCell.dimension} eyebrow={label(selectedCell.cell.paper_id)} onClose={() => setSelectedCell(null)}><p>{selectedCell.cell.value || "未提取到证据"}</p><p className="miniNotice">此单元格是综合分析的概述，请核对原文；来源标记不能代替可点击的原文定位。</p>{selectedCell.cell.source && <dl><dt>来源标记</dt><dd>{selectedCell.cell.source}</dd></dl>}<Link className="drawerAction" href={`/read?paper=${selectedCell.cell.paper_id}`}>打开论文核对 ↗</Link></EvidenceDrawer>}
  </main></>;
}
