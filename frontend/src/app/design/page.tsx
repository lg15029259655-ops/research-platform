"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import JobProgress from "@/components/jobs/JobProgress";
import { apiJson, postJson } from "@/lib/api";
import { useWorkspaceJob } from "@/lib/workspace-jobs";
import { addPaperToSynthesis, useWorkspace } from "@/lib/workspace";
import { tabGroup } from "@/lib/tabs";
import type { SimilarPaper } from "@/components/NoveltySpace";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import DesignStepEditor from "@/components/DesignStepEditor";
import type { Step } from "@/components/DesignFlow";
import "@/components/design-insights.css";

const DesignFlow = dynamic(() => import("@/components/DesignFlow"), { ssr: false });
const NoveltySpace = dynamic(() => import("@/components/NoveltySpace"), { ssr: false });
type Novelty = { query: string; similar_papers: SimilarPaper[];
  similarity_level: string; differences: string[]; novel_angles: string[]; evidence_scope: string;
  search_only?: boolean; search_message?: string };
type Design = { goal: string; change_summary: string; constraints: string[]; nodes: { id: string; label: string; type: string; detail: string; steps?: Step[] }[];
  edges: { source: string; target: string; label: string }[]; controls: string[]; readouts: string[]; assumptions: string[];
  input_constraints?: string; research_origin?: { research_gap?: string; synthesis_id?: string | null; selected_papers?: {paper_id: string; title: string}[] } };
type Artifact<T> = { id: string; payload: T; created_at: string };
type DesignVersion = { version_id: string; number: number; action: string; artifact_id: string;
  payload: Design; changes: { added: string[]; removed: string[]; modified: string[] } };
const actions = [["causality", "加强因果"], ["cost", "降低成本"], ["simplify", "简化方案"], ["mechanism", "增加机制"], ["application", "增强应用意义"]];
const actionLabels: Record<string, string> = {generate: "生成方案", manual: "手动编辑", node: "局部修改", causality: "加强因果",
  cost: "降低成本", simplify: "简化方案", mechanism: "增加机制", application: "增强应用"};

export default function DesignPage() {
  const router = useRouter();
  const urlIdea = useSearchParams().get("idea");
  const { workspace, workspaceError, refresh } = useWorkspace();
  const savedIdea = workspace?.design_idea || "";
  const pinnedSource = workspace?.gap_context.synthesis_id;
  const sourceHref = (id: string) => `/synthesis?view=gaps&artifact=${encodeURIComponent(id)}`;
  const [input, setInput] = useState<{ routeIdea: string | null; value: string } | null>(null);
  const idea = input && input.routeIdea === urlIdea ? input.value : urlIdea ?? savedIdea;
  const setIdea = (value: string) => setInput({ routeIdea: urlIdea, value });
  const [constraintDraft, setConstraints] = useState<string | null>(null);
  const [novelty, setNovelty] = useState<Novelty | null>(null);
  const [noveltyReady, setNoveltyReady] = useState(false);
  const [design, setDesign] = useState<Design | null>(null);
  const constraints = constraintDraft ?? (design?.goal.trim() === idea.trim() ? design?.input_constraints || "" : "");
  const [tab, setTab] = useState<"novelty" | "canvas">("novelty");
  const [localBusy, setBusy] = useState(false);
  const { job, start, cancel, dismiss } = useWorkspaceJob("design");
  const running = job?.status === "running";
  const busy = localBusy || running;
  const [error, setError] = useState("");
  const [taskCanceled, setTaskCanceled] = useState(false);
  const [versions, setVersions] = useState<DesignVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeInstruction, setNodeInstruction] = useState("");
  const [selectedChange, setSelectedChange] = useState<{label: string; kind: string} | null>(null);
  const [restoredDesignId, setRestoredDesignId] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [noveltyError, setNoveltyError] = useState("");
  const [designError, setDesignError] = useState("");
  const currentNoveltyId = workspace?.novelty_id;
  const currentDesignId = workspace?.design_version_id;
  const restoringDesign = !!currentDesignId && restoredDesignId !== currentDesignId && !designError;
  const restoringNovelty = !!currentNoveltyId && !noveltyReady && !noveltyError;
  const active = useRef(false);
  const workspaceTabs = tabGroup(["novelty", "canvas"] as const, tab, setTab);
  const sameDesignInput = design?.goal.trim() === idea.trim() && (design.input_constraints || "") === constraints.trim();
  const shownNovelty = novelty?.query.trim() === idea.trim() ? novelty : null;
  const shownDesign = design?.goal.trim() === idea.trim() ? design : null;
  useEffect(() => {
    setNoveltyError("");
    if (!currentNoveltyId) { setNovelty(null); setNoveltyReady(true); return; }
    const controller = new AbortController();
    setNoveltyReady(false);
    apiJson<Artifact<Novelty>[]>(`/api/research/artifacts?kind=novelty_analysis&artifact_id=${currentNoveltyId}`, { signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return;
        const candidate = items.find((item) => item.id === currentNoveltyId)?.payload;
        if (candidate?.query?.trim() !== savedIdea.trim()) throw new Error("找不到对应的新颖性结果");
        setNovelty(candidate);
      })
      .catch(() => { if (!controller.signal.aborted) setNoveltyError("暂时无法读取上次新颖性结果"); })
      .finally(() => { if (!controller.signal.aborted) setNoveltyReady(true); });
    return () => controller.abort();
  }, [currentNoveltyId, savedIdea, restoreAttempt]);
  useEffect(() => {
    setDesignError("");
    if (!savedIdea) { setVersions([]); setDesign(null); setCurrentVersion(null); setRestoredDesignId(null); return; }
    const controller = new AbortController();
    const options = { signal: controller.signal };
    async function restoreDesign() {
      const rows = await apiJson<DesignVersion[]>(`/api/research/design/versions?goal=${encodeURIComponent(savedIdea)}`, options);
      if (controller.signal.aborted) return;
      const match = rows.find((item) => item.artifact_id === currentDesignId);
      const version = match || (currentDesignId ? (await apiJson<DesignVersion[]>(`/api/research/design/versions?artifact_id=${currentDesignId}`, options))[0] : undefined);
      if (controller.signal.aborted) return;
      setVersions(version && !match ? [...rows, version] : rows);
      if (currentDesignId && version?.payload.goal.trim() !== savedIdea.trim()) throw new Error("找不到对应的设计版本");
      setDesign(version?.payload || null);
      setCurrentVersion(version?.version_id || null);
      setRestoredDesignId(currentDesignId || null);
    }
    void restoreDesign().catch(() => { if (!controller.signal.aborted) setDesignError("暂时无法读取已保存的设计版本"); });
    return () => controller.abort();
  }, [currentDesignId, savedIdea, restoreAttempt]);
  useEffect(() => {
    if (tab === "novelty" && !shownNovelty && shownDesign && !restoringNovelty && !busy && !error) setTab("canvas");
  }, [shownNovelty, shownDesign, tab, restoringNovelty, busy, error]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const submittedDraft = job?.draft;
  useEffect(() => {
    if (typeof submittedDraft?.idea !== "string" || (urlIdea !== null && urlIdea !== submittedDraft.idea)) return;
    setInput({ routeIdea: urlIdea, value: submittedDraft.idea });
    if (typeof submittedDraft.constraints === "string") setConstraints(submittedDraft.constraints);
  }, [submittedDraft, urlIdea]);
  useEffect(() => {
    if (!job || job.status === "running") return;
    if (job.status === "canceled") setTaskCanceled(true);
    if (job.status !== "done") {
      dismiss(job);
      if (job.status === "failed") setError(job.error || "任务未完成，请重试");
      return;
    }
    const result = job.result as Artifact<Novelty | Design> & { version?: DesignVersion } | null;
    if (!result?.payload) { dismiss(job); setError("任务没有返回可用结果"); return; }
    let disposed = false;
    void refresh(true).then((current) => {
      if (disposed) return;
      const pointer = job.kind === "novelty" ? current.novelty_id : current.design_version_id;
      if (pointer !== result.id) { setError("后台任务已完成，当前研究想法或方案已变化。"); return; }
      if (job.kind === "novelty") {
        setNovelty(result.payload as Novelty); setTab("novelty");
      } else {
        setDesign(result.payload as Design); setTab("canvas");
        const version = result.version;
        if (version) { setVersions((items) => [version, ...items]); setCurrentVersion(version.version_id); }
      }
    }).catch(() => {
      if (!disposed) setError("结果已保存，请重新打开本页读取。");
    }).finally(() => { if (!disposed) dismiss(job); });
    return () => { disposed = true; };
  }, [job, dismiss, refresh]);

  function scan(force = false) {
    if (busy) return;
    if (!force && shownNovelty) { setTab("novelty"); return; }
    setTab("novelty"); setError("");
    setTaskCanceled(false);
    void start("novelty", { query: idea.trim() }, { draft: { idea, constraints } });
  }

  function generate(action = "generate", nodeId?: string, instruction = "", force = false) {
    if (busy) return;
    if (action === "generate" && sameDesignInput && !force) { setTab("canvas"); return; }
    setTab("canvas"); setError("");
    setTaskCanceled(false);
    void start("design", { goal: idea.trim(), constraints, action,
      current_design: action === "generate" ? null : design,
      node_id: nodeId, instruction, regenerate: force,
    }, { draft: { idea, constraints } });
  }
  async function restoreVersion(version: DesignVersion) {
    setBusy(true); setError("");
    try { const restored = await apiJson<DesignVersion>(`/api/research/design/versions/${version.version_id}/restore`, {method: "POST"});
      setDesign(restored.payload); setCurrentVersion(restored.version_id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "版本恢复失败"); }
    finally { setBusy(false); }
  }
  const scopedVersions = Array.from(new Map(versions.filter((item) =>
    item.payload.goal.trim() === design?.goal.trim()).map((item) => [item.version_id, item])).values())
    .sort((a, b) => a.number - b.number);
  const activeIndex = scopedVersions.findIndex((item) => item.version_id === currentVersion);
  const displayVersion = activeIndex < 0 ? 1 : activeIndex + 1;
  const activeVersion = scopedVersions[activeIndex];
  const priorVersion = activeIndex > 0 ? scopedVersions[activeIndex - 1] : null;
  const nodeDetail = design?.nodes.find((item) => item.id === selectedNode);
  function openChange(label: string, kind: string) {
    const node = design?.nodes.find((item) => item.label === label || item.id === label);
    if (node) { setSelectedNode(node.id); setSelectedChange(null); }
    else setSelectedChange({label, kind});
  }
  async function importWork(paper: SimilarPaper) {
    return postJson<{id: string}>("/api/research/import", {openalex_id: paper.openalex_id});
  }
  async function viewWork(paper: SimilarPaper) {
    setBusy(true); setError("");
    try {
      const saved = await importWork(paper);
      if (active.current) router.push(`/read?paper=${encodeURIComponent(saved.id)}`);
    } catch (e) { setError(e instanceof Error ? e.message : "无法打开论文"); }
    finally { setBusy(false); }
  }
  async function addWork(paper: SimilarPaper) {
    setBusy(true); setError("");
    try {
      const ids = workspace?.selected_paper_ids || [];
      // 先判上限再 import。原来的顺序是先入库再判上限，超限时论文已经写进论文库，
      // 用户看到报错、回论文库却多了一条自己不想要的记录。
      if (ids.length >= 5) throw new Error("对比篮最多 5 篇论文，请先在文献综合页移除一篇");
      const saved = await importWork(paper);
      await addPaperToSynthesis(saved.id);
    } catch (e) { setError(e instanceof Error ? e.message : "加入对比失败"); }
    finally { setBusy(false); }
  }
  async function saveStageSteps(id: string, steps: Step[]) {
    if (!activeVersion || !shownDesign) throw new Error("当前版本尚未加载");
    const draft = { ...shownDesign, nodes: shownDesign.nodes.map(node => node.id === id ? { ...node, steps } : node) };
    const result = await postJson<{payload: Design; version: DesignVersion}>("/api/research/design/manual", { artifact_id: activeVersion.artifact_id, design: draft });
    setDesign(result.payload); setVersions(items => [result.version, ...items]); setCurrentVersion(result.version.version_id);
    await refresh().catch(() => {});
  }
  return <main id="main" className="researchPage">
    <div className="pageIntro"><div className="eyebrow">04 / DESIGN</div><h1>让研究想法成为可检验的方案。</h1><p>结合文献线索和研究条件，设计可展开的实验路线，并逐步检查对照、指标与可能结果。</p></div>
    {workspace?.design_idea && workspace.design_idea.trim() === idea.trim() && workspace.research_gap && (!workspace.gap_context.question || workspace.gap_context.question === workspace.design_idea) && <details className="di-origin" open><summary>研究起点 · 来自文献综合</summary><p><b>研究空白：</b>{workspace.research_gap}</p><p><b>当前问题：</b>{workspace.design_idea}</p><p>这是第三部分的综合线索，请结合对应论文原文核对；不是已独立证实的实验事实。</p><Link className="quietButton" href={typeof pinnedSource === "string" ? sourceHref(pinnedSource) : "/synthesis?view=gaps"}>返回研究空白查看依据 ↗</Link></details>}
    <section className="sectionBox"><label className="fieldLabel" htmlFor="idea">我的研究想法</label><textarea id="idea" className="largeTextarea" disabled={running} value={idea} onChange={(e) => { setIdea(e.target.value); setError(""); setTab("novelty"); }} placeholder="例如：用更低成本的单细胞方法识别治疗前肿瘤耐药亚群" /><label className="fieldLabel" htmlFor="constraints">约束条件（可选）</label><input id="constraints" className="largeInput" disabled={running} value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="经费、样本量、数据来源、周期等" /><div className="actionRow"><button className="primaryButton" disabled={busy || idea.trim().length < 5} aria-busy={busy} onClick={() => scan()}>{busy ? "分析中…" : "检索相似研究"}</button><button disabled={busy || idea.trim().length < 5} aria-busy={busy} onClick={() => generate()}>生成研究设计 →</button></div></section>
    {!workspace && !workspaceError && !urlIdea && <p className="workspaceLoading" role="status">正在读取研究问题…</p>}
    {(restoringDesign || restoringNovelty) && <p className="workspaceLoading" role="status">正在恢复上次研究结果…</p>}
    {(designError || noveltyError) && <div className="researchError" role="alert">{[noveltyError, designError].filter(Boolean).join("；")} <button className="quietButton" onClick={() => setRestoreAttempt((count) => count + 1)}>重试</button></div>}
    {!!workspace && !idea.trim() && !shownNovelty && !shownDesign && !busy && <section className="startGuide" aria-label="科研设计使用引导"><div className="startGuideIntro"><span>START HERE</span><h2>把一个想法，推进为可核验的研究路径。</h2><p>先填入自己的研究问题。你可以检索相似研究，也可以直接生成设计草稿；两项结果会清楚标注证据范围。</p><div className="sampleIdeas"><b>试一个示例</b>{["如何降低肿瘤单细胞测序的样本与计算成本？", "如何验证候选基因对肿瘤细胞迁移的影响？", "如何研究代谢通路与肿瘤免疫微环境的关系？"].map((sample) => <button key={sample} disabled={running} onClick={() => { setIdea(sample); document.getElementById("idea")?.focus(); }}>{sample} ↗</button>)}</div></div><div className="startGuideSteps"><div><b>01</b><strong>提出问题</strong><small>明确对象、变量与目标</small></div><div><b>02</b><strong>核对相似研究</strong><small>基于摘要做定性扫描</small></div><div><b>03</b><strong>搭建设计草稿</strong><small>检查对照、读数与假设</small></div></div></section>}
    {error && <div className="researchError" role="alert">{error}</div>}
    {taskCanceled && <p className="workspaceLoading" role="status">任务已取消。</p>}
    {/* 阶段文案以服务端为准；可取消，也可以离开本页——任务在服务端继续。 */}
    <JobProgress variant="fixed" title="正在处理研究设计" stageLabel={job?.stage} progress={job?.progress} startedAt={running ? job.startedAt : null} onCancel={cancel} cancelPending={job?.cancelPending} cancelError={job?.cancelError} reconnecting={job?.reconnecting} />
    {(shownNovelty || shownDesign || !!idea.trim()) && <div className="resultBar"><strong>工作区</strong><div className="tabBar" {...workspaceTabs.list} aria-label="工作区视图"><button {...workspaceTabs.item("novelty")}>新颖性扫描</button><button {...workspaceTabs.item("canvas")}>设计沙盘</button></div></div>}
    {/* D10：某个 tab 无数据时给出空态，不留白。 */}
    {tab === "novelty" && !shownNovelty && !!idea.trim() && !busy && !restoringNovelty && !restoringDesign && !noveltyError && <div className="miniNotice">当前想法「{idea.trim()}」尚无检索结果。请点击「检索相似研究」；若检索失败，请稍后重试。</div>}
    {tab === "canvas" && !shownDesign && !!idea.trim() && !busy && !restoringDesign && !designError && <div className="miniNotice">当前想法「{idea.trim()}」尚无设计草稿。点击上方「生成研究设计」即可创建。</div>}
    {tab === "novelty" && shownNovelty && <section className="sectionBox"><h2>{shownNovelty.search_only ? "相关文献星系" : "新颖性扫描"} {!shownNovelty.search_only && <small>整体相似：{shownNovelty.similarity_level}</small>}</h2>{shownNovelty.search_only && <p className="miniNotice">{shownNovelty.search_message} 单一轨道仅表示检索结果，不代表已完成相似程度判断。{!shownNovelty.similar_papers.length && "请调整关键词后重试。"}</p>}<NoveltySpace novelty={shownNovelty} busy={busy} onView={viewWork} onAdd={addWork} />{shownNovelty.search_only && <button type="button" disabled={busy} onClick={() => scan(true)}>重试模型分析</button>}<button className="primaryButton stepForward" disabled={busy} aria-busy={busy} onClick={() => generate()}>{sameDesignInput ? "打开已有方案 →" : "基于这个想法生成方案 →"}</button></section>}
    {tab === "canvas" && shownDesign && <><div className="versionBar"><strong>方案版本 <span>V{displayVersion}</span></strong><div>{scopedVersions.length > 1 && scopedVersions.map((item, index) => <button className={item.version_id === currentVersion ? "active" : ""} key={item.version_id} disabled={busy} aria-busy={busy} onClick={() => restoreVersion(item)}>V{index + 1} · {actionLabels[item.action] || item.action}</button>)}</div>{priorVersion && <button onClick={() => restoreVersion(priorVersion)} disabled={busy} aria-busy={busy}>撤回上一版本</button>}<button onClick={() => generate("generate", undefined, "", true)} disabled={busy} aria-busy={busy}>重新生成方案</button></div><div className="designGrid"><section className="sectionBox designSidebar"><div className="designSideHeader"><span>方案概览</span><h2>设计调整</h2><p title={shownDesign.goal}>{shownDesign.goal}</p></div><div className="designSummary"><b>本版思路</b><p>{shownDesign.change_summary || "当前为方案草稿。"}</p><details><summary>阅读完整说明</summary><p>{shownDesign.change_summary || "当前为方案草稿。"}</p></details></div><div className="designActions"><b>调整方向</b><div className="actionRow">{actions.map(([action, label]) => <button key={action} disabled={busy} aria-busy={busy} onClick={() => generate(action)}>{label}</button>)}</div></div><details className="designDetails"><summary>本次修改 <small>{activeVersion ? activeVersion.changes.added.length + activeVersion.changes.removed.length + activeVersion.changes.modified.length : 0} 项</small></summary><div className="versionChanges">{activeVersion ? <>{activeVersion.changes.added.map((item) => <button key={`a${item}`} onClick={() => openChange(item, "新增")}>＋ {item} ↗</button>)}{activeVersion.changes.removed.map((item) => <button key={`r${item}`} onClick={() => openChange(item, "移除")}>－ {item} ↗</button>)}{activeVersion.changes.modified.map((item) => <button key={`m${item}`} onClick={() => openChange(item, "修改")}>◌ {item} ↗</button>)}</> : "初始方案"}</div></details><details className="designDetails"><summary>对照与评价 <small>{shownDesign.controls.length + shownDesign.readouts.length} 项</small></summary><h4>对照</h4><ul>{shownDesign.controls.map((item, i) => <li key={i}>{item}</li>)}</ul><h4>评价指标</h4><ul>{shownDesign.readouts.map((item, i) => <li key={i}>{item}</li>)}</ul></details><details className="designDetails"><summary>关键假设 <small>{shownDesign.assumptions.length} 项</small></summary><ul>{shownDesign.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></details></section><section><DesignFlow design={shownDesign} artifactId={activeVersion?.artifact_id || ""} onSelectNode={setSelectedNode} busy={busy} onExpandNode={(id) => generate("node", id, "为此阶段补充具体实验或分析步骤，逐项说明目的、方法、对照和检测指标；未知信息明确待确定，并保留其他阶段。" )} onAddStep={async (id, step) => { const node = shownDesign.nodes.find(item => item.id === id); if (!node) throw new Error("当前步骤已变化"); await saveStageSteps(id, [...(node.steps || []), step]); }} onRemoveStep={async (id, index) => { const node = shownDesign.nodes.find(item => item.id === id); if (!node) throw new Error("当前步骤已变化"); await saveStageSteps(id, (node.steps || []).filter((_, i) => i !== index)); }} /><p className="miniNotice">具体参数需预实验、功效分析或领域专家核对。</p></section></div>{nodeDetail && <EvidenceDrawer title={nodeDetail.label} eyebrow="研究设计节点" onClose={() => setSelectedNode(null)}><p>{nodeDetail.detail}</p><div className="nodeRelations"><strong>连接逻辑</strong>{shownDesign.edges.filter((edge) => edge.source === nodeDetail.id || edge.target === nodeDetail.id).map((edge, index) => <p key={index}>{edge.label || `${shownDesign.nodes.find((item) => item.id === edge.source)?.label || edge.source} → ${shownDesign.nodes.find((item) => item.id === edge.target)?.label || edge.target}`}</p>)}</div><dl><dt>节点类型</dt><dd>{nodeDetail.type}</dd><dt>版本</dt><dd>V{displayVersion}</dd></dl><label className="fieldLabel">希望怎样修改这个节点？</label><textarea className="largeTextarea" value={nodeInstruction} onChange={(e) => setNodeInstruction(e.target.value)} placeholder="例如：改用成本更低的数据来源，并保持评估目标不变" /><button className="drawerAction" disabled={busy || !nodeInstruction.trim()} aria-busy={busy} onClick={() => generate("node", nodeDetail.id, nodeInstruction)}>AI 优化此节点 →</button></EvidenceDrawer>}{selectedChange && <EvidenceDrawer title={selectedChange.label} eyebrow={`版本差异 · ${selectedChange.kind}`} onClose={() => setSelectedChange(null)}><p>这条记录属于 V{displayVersion} 的版本变化。当前方案中没有同名节点；可切换历史版本查看当时的完整结构。</p></EvidenceDrawer>}</>}
    {tab === "canvas" && shownDesign && activeVersion && <><details className="di-origin"><summary>本版本的研究起点与依据</summary>{shownDesign.research_origin?.research_gap ? <><p><b>研究空白：</b>{shownDesign.research_origin.research_gap}</p><ul>{shownDesign.research_origin.selected_papers?.map(paper => <li key={paper.paper_id}>{paper.title}</li>)}</ul><p>以上为生成时带入的综合线索，需回到文献核对；尚未逐条绑定到方案节点。</p>{shownDesign.research_origin.synthesis_id && <Link className="quietButton" href={sourceHref(shownDesign.research_origin.synthesis_id)}>打开本版本的文献综合 ↗</Link>}</> : <p>本版本未记录可用的文献综合依据。研究问题可能由用户输入，或来自旧版方案；请自行补充并核对依据。</p>}</details><DesignStepEditor artifactId={activeVersion.artifact_id} design={shownDesign} onSaved={(payload, version) => { setDesign(payload); setVersions(items => [version, ...items]); setCurrentVersion(version.version_id); void refresh(); }} /></>}
  </main>;
}
