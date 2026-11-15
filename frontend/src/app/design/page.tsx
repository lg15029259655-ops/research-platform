"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ResearchNav from "@/components/ResearchNav";
import JobProgress from "@/components/jobs/JobProgress";
import { apiJson, postJson } from "@/lib/api";
import { submitJob, watchJob, type JobProgress as JobProgressData } from "@/lib/jobs";
import { useWorkspace } from "@/lib/workspace";
import { updateWorkspace } from "@/lib/workspace";
import { tabGroup } from "@/lib/tabs";
import type { SimilarPaper } from "@/components/NoveltySpace";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import DesignStepEditor from "@/components/DesignStepEditor";
import type { Step } from "@/components/DesignFlow";
import "../research.css";
import "../studio.css";
import "@/components/experiment-route.css";
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
  const [idea, setIdea] = useState("");
  const [constraints, setConstraints] = useState("");
  const [novelty, setNovelty] = useState<Novelty | null>(null);
  const [noveltyReady, setNoveltyReady] = useState(false);
  const [design, setDesign] = useState<Design | null>(null);
  const [tab, setTab] = useState<"novelty" | "canvas">("novelty");
  const [busy, setBusy] = useState(false);
  // 新颖性/设计都是慢调用，统一走后台任务；阶段与进度由 JobProgress 呈现。
  const [jobStage, setJobStage] = useState("");
  const [jobProgress, setJobProgress] = useState<JobProgressData | null>(null);
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const activeJobAbort = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<DesignVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeInstruction, setNodeInstruction] = useState("");
  const [selectedChange, setSelectedChange] = useState<{label: string; kind: string} | null>(null);
  const { workspace, refresh } = useWorkspace();
  // 记录已经按 artifact_id 精确补查过的指针，避免 effect 因 versions 变化反复发请求。
  const versionLookups = useRef<Set<string>>(new Set());
  const workspaceTabs = tabGroup(["novelty", "canvas"] as const, tab, setTab);
  const sameDesignInput = design?.goal.trim() === idea.trim() && (design.input_constraints || "") === constraints.trim();
  const shownNovelty = novelty?.query.trim() === idea.trim() ? novelty : null;
  const shownDesign = design?.goal.trim() === idea.trim() ? design : null;
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("idea");
    if (fromUrl) setIdea(fromUrl);
  }, []);
  useEffect(() => {
    if (!workspace?.design_idea) return;
    apiJson<DesignVersion[]>(`/api/research/design/versions?goal=${encodeURIComponent(workspace.design_idea)}`)
      .then(setVersions).catch(() => {});
  }, [workspace?.design_idea]);
  useEffect(() => { if (workspace?.design_idea && !idea) setIdea(workspace.design_idea); }, [workspace?.design_idea]);
  useEffect(() => {
    if (!workspace) return;
    if (!workspace.novelty_id) { setNovelty(null); setNoveltyReady(true); return; }
    setNoveltyReady(false);
    apiJson<Artifact<Novelty>[]>(`/api/research/artifacts?kind=novelty_analysis&artifact_id=${workspace.novelty_id}`)
      .then((items) => { const candidate = items.find((item) => item.id === workspace.novelty_id)?.payload;
        setNovelty(candidate?.query?.trim() === workspace.design_idea.trim() ? candidate : null); })
      .catch(() => setNovelty(null)).finally(() => setNoveltyReady(true));
  }, [workspace?.novelty_id]);
  useEffect(() => {
    const pointer = workspace?.design_version_id;
    if (!workspace) return;
    if (!pointer) { setDesign(null); setCurrentVersion(null); return; }
    const apply = (version: DesignVersion) => {
      // prune_stale_idea_results 的判据是 payload.goal 与 design_idea 同源，前端再核一次。
      if (version.payload.goal.trim() === workspace.design_idea.trim()) { setDesign(version.payload); setCurrentVersion(version.version_id); }
      else { setDesign(null); setCurrentVersion(null); }
    };
    const match = versions.find((item) => item.artifact_id === pointer);
    if (match) { apply(match); return; }
    // 版本列表只回最近 20 条，指针可能更老；按 artifact_id 精确补一次，否则沙盘会凭空空白。
    if (versionLookups.current.has(pointer)) { setDesign(null); setCurrentVersion(null); return; }
    versionLookups.current.add(pointer);
    apiJson<DesignVersion[]>(`/api/research/design/versions?artifact_id=${pointer}`)
      .then((rows) => { if (rows.length) { setVersions((items) => [...items, rows[0]]); apply(rows[0]); } else { setDesign(null); setCurrentVersion(null); } })
      .catch(() => { setDesign(null); setCurrentVersion(null); });
  }, [workspace?.design_version_id, versions]);
  useEffect(() => {
    if (tab === "novelty" && !shownNovelty && shownDesign && noveltyReady && !busy && !error) setTab("canvas");
  }, [shownNovelty, shownDesign, tab, noveltyReady, busy, error]);
  // 离开页面时取消后台任务：用户不会再回来看的任务不该继续占用模型配额。
  useEffect(() => () => { activeJobAbort.current?.abort(); }, []);
  async function scan(force = false) {
    if (!force && novelty?.query.trim() === idea.trim()) { setTab("novelty"); return; }
    const previous = novelty;
    // 上一个任务还没结束时先取消，避免两个结果互相覆盖。
    activeJobAbort.current?.abort();
    const controller = new AbortController();
    activeJobAbort.current = controller;
    setNovelty(null); setTab("novelty");
    setBusy(true); setError(""); setJobStage("正在提交检索任务"); setJobStartedAt(Date.now()); setJobProgress(null);
    try {
      const job = await submitJob("novelty", { query: idea.trim() });
      const snapshot = await watchJob(job.id, {
        onStage: (_stage, label) => setJobStage(label),
        onProgress: (progress) => setJobProgress(progress),
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (snapshot.status !== "done") throw new Error(snapshot.error?.message || "检索失败，请稍后重试");
      const artifact = snapshot.result as Artifact<Novelty> | null;
      if (!artifact?.payload) throw new Error("新颖性扫描没有返回可用结果");
      setNovelty(artifact.payload); setTab("novelty"); await refresh();
    } catch (e) {
      if (!controller.signal.aborted) {
        setNovelty(previous?.query.trim() === idea.trim() ? previous : null);
        setError(e instanceof Error ? e.message : "检索失败");
      }
    } finally {
      if (activeJobAbort.current === controller) {
        activeJobAbort.current = null; setBusy(false); setJobStartedAt(null); setJobProgress(null); setJobStage("");
      }
    }
  }
  async function generate(action = "generate", nodeId?: string, instruction = "", force = false) {
    if (action === "generate" && sameDesignInput && !force) { setTab("canvas"); return; }
    const previous = design;
    if (action === "generate") { setDesign(null); setTab("canvas"); }
    activeJobAbort.current?.abort();
    const controller = new AbortController();
    activeJobAbort.current = controller;
    setBusy(true); setError(""); setJobStage("正在提交设计任务"); setJobStartedAt(Date.now()); setJobProgress(null);
    try {
      const job = await submitJob("design", {
        goal: idea.trim(), constraints, action,
        current_design: action === "generate" ? null : design,
        node_id: nodeId, instruction, regenerate: force,
      });
      const snapshot = await watchJob(job.id, {
        onStage: (_stage, label) => setJobStage(label),
        onProgress: (progress) => setJobProgress(progress),
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (snapshot.status !== "done") throw new Error(snapshot.error?.message || "方案生成失败，请重试");
      const artifact = snapshot.result as (Artifact<Design> & { version?: DesignVersion }) | null;
      if (!artifact?.payload) throw new Error("设计任务没有返回可用结果");
      setDesign(artifact.payload); setTab("canvas");
      const version = artifact.version;
      if (version) { setVersions((items) => [version, ...items]); setCurrentVersion(version.version_id); }
      await refresh();
    } catch (e) {
      if (!controller.signal.aborted) {
        setDesign(previous?.goal.trim() === idea.trim() ? previous : null);
        setError(e instanceof Error ? e.message : "方案生成失败");
      }
    } finally {
      if (activeJobAbort.current === controller) {
        activeJobAbort.current = null; setBusy(false); setJobStartedAt(null); setJobProgress(null); setJobStage("");
      }
    }
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
    try { const saved = await importWork(paper); router.push(`/read?paper=${saved.id}`); }
    catch (e) { setError(e instanceof Error ? e.message : "无法打开论文"); setBusy(false); }
  }
  async function addWork(paper: SimilarPaper) {
    setBusy(true); setError("");
    try {
      const ids = workspace?.selected_paper_ids || [];
      // 先判上限再 import。原来的顺序是先入库再判上限，超限时论文已经写进论文库，
      // 用户看到报错、回论文库却多了一条自己不想要的记录。
      if (ids.length >= 5) throw new Error("对比篮最多 5 篇论文，请先在文献综合页移除一篇");
      const saved = await importWork(paper);
      if (ids.includes(saved.id)) return;
      await updateWorkspace({selected_paper_ids: [...ids, saved.id]});
      await refresh();
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
  return <><ResearchNav current="/design" /><main id="main" className="researchPage">
    <div className="pageIntro"><div className="eyebrow">04 / DESIGN</div><h1>让研究想法成为可检验的方案。</h1><p>结合文献线索和研究条件，设计可展开的实验路线，并逐步检查对照、指标与可能结果。</p></div>
    {workspace?.design_idea && workspace.design_idea.trim() === idea.trim() && workspace.research_gap && <details className="di-origin" open><summary>研究起点 · 来自文献综合</summary><p><b>研究空白：</b>{workspace.research_gap}</p><p><b>当前问题：</b>{workspace.design_idea}</p><p>这是第三部分的综合线索，请结合对应论文原文核对；不是已独立证实的实验事实。</p><button onClick={() => router.push("/synthesis")}>返回文献综合查看依据 ↗</button></details>}
    <section className="sectionBox"><label className="fieldLabel" htmlFor="idea">我的研究想法</label><textarea id="idea" className="largeTextarea" value={idea} onChange={(e) => { setIdea(e.target.value); setError(""); setTab("novelty"); }} placeholder="例如：用更低成本的单细胞方法识别治疗前肿瘤耐药亚群" /><label className="fieldLabel" htmlFor="constraints">约束条件（可选）</label><input id="constraints" className="largeInput" value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="经费、样本量、数据来源、周期等" /><div className="actionRow"><button className="primaryButton" disabled={busy || idea.trim().length < 5} aria-busy={busy} onClick={() => scan()}>{busy ? "分析中…" : "检索相似研究"}</button><button disabled={busy || idea.trim().length < 5} aria-busy={busy} onClick={() => generate()}>生成研究设计 →</button></div></section>
    {!idea.trim() && !shownNovelty && !shownDesign && !busy && <section className="startGuide" aria-label="科研设计使用引导"><div className="startGuideIntro"><span>START HERE</span><h2>把一个想法，推进为可核验的研究路径。</h2><p>先填入自己的研究问题。你可以检索相似研究，也可以直接生成设计草稿；两项结果会清楚标注证据范围。</p><div className="sampleIdeas"><b>试一个示例</b>{["如何降低肿瘤单细胞测序的样本与计算成本？", "如何验证候选基因对肿瘤细胞迁移的影响？", "如何研究代谢通路与肿瘤免疫微环境的关系？"].map((sample) => <button key={sample} onClick={() => { setIdea(sample); document.getElementById("idea")?.focus(); }}>{sample} ↗</button>)}</div></div><div className="startGuideSteps"><div><b>01</b><strong>提出问题</strong><small>明确对象、变量与目标</small></div><div><b>02</b><strong>核对相似研究</strong><small>基于摘要做定性扫描</small></div><div><b>03</b><strong>搭建设计草稿</strong><small>检查对照、读数与假设</small></div></div></section>}
    {error && <div className="researchError" role="alert">{error}</div>}
    {/* 阶段文案以服务端为准；可取消，也可以离开本页——任务在服务端继续。 */}
    <JobProgress variant="fixed" title="正在处理研究设计" stageLabel={jobStage} progress={jobProgress} startedAt={jobStartedAt} onCancel={() => activeJobAbort.current?.abort()} />
    {(shownNovelty || shownDesign) && <div className="resultBar"><strong>工作区</strong><div className="tabBar" {...workspaceTabs.list} aria-label="工作区视图"><button {...workspaceTabs.item("novelty")}>新颖性扫描</button><button {...workspaceTabs.item("canvas")}>设计沙盘</button></div></div>}
    {/* D10：某个 tab 无数据时给出空态，不留白。 */}
    {tab === "novelty" && !shownNovelty && !!idea.trim() && !busy && <div className="miniNotice">当前想法「{idea.trim()}」尚无检索结果。请点击「检索相似研究」；若检索失败，请稍后重试。</div>}
    {tab === "canvas" && !shownDesign && !!idea.trim() && !busy && <div className="miniNotice">当前想法「{idea.trim()}」尚无设计草稿。点击上方「生成研究设计」即可创建。</div>}
    {tab === "novelty" && shownNovelty && <section className="sectionBox"><h2>{shownNovelty.search_only ? "相关文献星系" : "新颖性扫描"} {!shownNovelty.search_only && <small>整体相似：{shownNovelty.similarity_level}</small>}</h2>{shownNovelty.search_only && <p className="miniNotice">{shownNovelty.search_message} 单一轨道仅表示检索结果，不代表已完成相似程度判断。{!shownNovelty.similar_papers.length && "请调整关键词后重试。"}</p>}<NoveltySpace novelty={shownNovelty} busy={busy} onView={viewWork} onAdd={addWork} />{shownNovelty.search_only && <button type="button" disabled={busy} onClick={() => scan(true)}>重试模型分析</button>}<button className="primaryButton stepForward" disabled={busy} aria-busy={busy} onClick={() => generate()}>{sameDesignInput ? "打开已有方案 →" : "基于这个想法生成方案 →"}</button></section>}
    {tab === "canvas" && shownDesign && <><div className="versionBar"><strong>方案版本 <span>V{displayVersion}</span></strong><div>{scopedVersions.length > 1 && scopedVersions.map((item, index) => <button className={item.version_id === currentVersion ? "active" : ""} key={item.version_id} disabled={busy} aria-busy={busy} onClick={() => restoreVersion(item)}>V{index + 1} · {actionLabels[item.action] || item.action}</button>)}</div>{priorVersion && <button onClick={() => restoreVersion(priorVersion)} disabled={busy} aria-busy={busy}>撤回上一版本</button>}<button onClick={() => generate("generate", undefined, "", true)} disabled={busy} aria-busy={busy}>重新生成方案</button></div><div className="designGrid"><section className="sectionBox designSidebar"><div className="designSideHeader"><span>方案概览</span><h2>设计调整</h2><p title={shownDesign.goal}>{shownDesign.goal}</p></div><div className="designSummary"><b>本版思路</b><p>{shownDesign.change_summary || "当前为方案草稿。"}</p><details><summary>阅读完整说明</summary><p>{shownDesign.change_summary || "当前为方案草稿。"}</p></details></div><div className="designActions"><b>调整方向</b><div className="actionRow">{actions.map(([action, label]) => <button key={action} disabled={busy} aria-busy={busy} onClick={() => generate(action)}>{label}</button>)}</div></div><details className="designDetails"><summary>本次修改 <small>{activeVersion ? activeVersion.changes.added.length + activeVersion.changes.removed.length + activeVersion.changes.modified.length : 0} 项</small></summary><div className="versionChanges">{activeVersion ? <>{activeVersion.changes.added.map((item) => <button key={`a${item}`} onClick={() => openChange(item, "新增")}>＋ {item} ↗</button>)}{activeVersion.changes.removed.map((item) => <button key={`r${item}`} onClick={() => openChange(item, "移除")}>－ {item} ↗</button>)}{activeVersion.changes.modified.map((item) => <button key={`m${item}`} onClick={() => openChange(item, "修改")}>◌ {item} ↗</button>)}</> : "初始方案"}</div></details><details className="designDetails"><summary>对照与评价 <small>{shownDesign.controls.length + shownDesign.readouts.length} 项</small></summary><h4>对照</h4><ul>{shownDesign.controls.map((item, i) => <li key={i}>{item}</li>)}</ul><h4>评价指标</h4><ul>{shownDesign.readouts.map((item, i) => <li key={i}>{item}</li>)}</ul></details><details className="designDetails"><summary>关键假设 <small>{shownDesign.assumptions.length} 项</small></summary><ul>{shownDesign.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></details></section><section><DesignFlow design={shownDesign} artifactId={activeVersion?.artifact_id || ""} onSelectNode={setSelectedNode} busy={busy} onExpandNode={(id) => generate("node", id, "为此阶段补充具体实验或分析步骤，逐项说明目的、方法、对照和检测指标；未知信息明确待确定，并保留其他阶段。" )} onAddStep={async (id, step) => { const node = shownDesign.nodes.find(item => item.id === id); if (!node) throw new Error("当前步骤已变化"); await saveStageSteps(id, [...(node.steps || []), step]); }} onRemoveStep={async (id, index) => { const node = shownDesign.nodes.find(item => item.id === id); if (!node) throw new Error("当前步骤已变化"); await saveStageSteps(id, (node.steps || []).filter((_, i) => i !== index)); }} /><p className="miniNotice">具体参数需预实验、功效分析或领域专家核对。</p></section></div>{nodeDetail && <EvidenceDrawer title={nodeDetail.label} eyebrow="研究设计节点" onClose={() => setSelectedNode(null)}><p>{nodeDetail.detail}</p><div className="nodeRelations"><strong>连接逻辑</strong>{shownDesign.edges.filter((edge) => edge.source === nodeDetail.id || edge.target === nodeDetail.id).map((edge, index) => <p key={index}>{edge.label || `${shownDesign.nodes.find((item) => item.id === edge.source)?.label || edge.source} → ${shownDesign.nodes.find((item) => item.id === edge.target)?.label || edge.target}`}</p>)}</div><dl><dt>节点类型</dt><dd>{nodeDetail.type}</dd><dt>版本</dt><dd>V{displayVersion}</dd></dl><label className="fieldLabel">希望怎样修改这个节点？</label><textarea className="largeTextarea" value={nodeInstruction} onChange={(e) => setNodeInstruction(e.target.value)} placeholder="例如：改用成本更低的数据来源，并保持评估目标不变" /><button className="drawerAction" disabled={busy || !nodeInstruction.trim()} aria-busy={busy} onClick={() => generate("node", nodeDetail.id, nodeInstruction)}>AI 优化此节点 →</button></EvidenceDrawer>}{selectedChange && <EvidenceDrawer title={selectedChange.label} eyebrow={`版本差异 · ${selectedChange.kind}`} onClose={() => setSelectedChange(null)}><p>这条记录属于 V{displayVersion} 的版本变化。当前方案中没有同名节点；可切换历史版本查看当时的完整结构。</p></EvidenceDrawer>}</>}
    {tab === "canvas" && shownDesign && activeVersion && <><details className="di-origin"><summary>本版本的研究起点与依据</summary>{shownDesign.research_origin?.research_gap ? <><p><b>研究空白：</b>{shownDesign.research_origin.research_gap}</p><ul>{shownDesign.research_origin.selected_papers?.map(paper => <li key={paper.paper_id}>{paper.title}</li>)}</ul><p>以上为生成时带入的综合线索，需回到文献核对；尚未逐条绑定到方案节点。</p></> : <p>本版本未记录可用的文献综合依据。研究问题可能由用户输入，或来自旧版方案；请自行补充并核对依据。</p>}</details><DesignStepEditor artifactId={activeVersion.artifact_id} design={shownDesign} onSaved={(payload, version) => { setDesign(payload); setVersions(items => [version, ...items]); setCurrentVersion(version.version_id); void refresh(); }} /></>}
  </main></>;
}
