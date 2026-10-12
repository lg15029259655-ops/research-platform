"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ResearchNav from "@/components/ResearchNav";
import { apiJson, postJson } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { updateWorkspace } from "@/lib/workspace";
import type { SimilarPaper } from "@/components/NoveltySpace";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import StepLoading from "@/components/StepLoading";
import "../research.css";
import "../studio.css";

const DesignFlow = dynamic(() => import("@/components/DesignFlow"), { ssr: false });
const NoveltySpace = dynamic(() => import("@/components/NoveltySpace"), { ssr: false });
type Novelty = { query: string; similar_papers: SimilarPaper[];
  similarity_level: string; differences: string[]; novel_angles: string[]; evidence_scope: string };
type Design = { goal: string; change_summary: string; constraints: string[]; nodes: { id: string; label: string; type: string; detail: string }[];
  edges: { source: string; target: string; label: string }[]; controls: string[]; readouts: string[]; assumptions: string[] };
type Artifact<T> = { id: string; payload: T; created_at: string };
type DesignVersion = { version_id: string; number: number; action: string; artifact_id: string;
  payload: Design; changes: { added: string[]; removed: string[]; modified: string[] } };
const actions = [["causality", "加强因果"], ["cost", "降低成本"], ["simplify", "简化方案"], ["mechanism", "增加机制"], ["application", "增强应用意义"]];

export default function DesignPage() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [constraints, setConstraints] = useState("");
  const [novelty, setNovelty] = useState<Novelty | null>(null);
  const [noveltyReady, setNoveltyReady] = useState(false);
  const [design, setDesign] = useState<Design | null>(null);
  const [tab, setTab] = useState<"novelty" | "canvas">("novelty");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<DesignVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeInstruction, setNodeInstruction] = useState("");
  const [selectedChange, setSelectedChange] = useState<{label: string; kind: string} | null>(null);
  const { workspace, refresh } = useWorkspace();
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("idea");
    if (fromUrl) setIdea(fromUrl);
    apiJson<DesignVersion[]>("/api/research/design/versions").then(setVersions).catch(() => {});
  }, []);
  useEffect(() => { if (workspace?.design_idea && !idea) setIdea(workspace.design_idea); }, [workspace?.design_idea]);
  useEffect(() => {
    if (!workspace) return;
    if (!workspace.novelty_id) { setNovelty(null); setNoveltyReady(true); return; }
    setNoveltyReady(false);
    apiJson<Artifact<Novelty>[]>("/api/research/artifacts?kind=novelty_analysis")
      .then((items) => { const candidate = items.find((item) => item.id === workspace.novelty_id)?.payload;
        setNovelty(candidate?.query?.trim() === workspace.design_idea.trim() ? candidate : null); })
      .catch(() => setNovelty(null)).finally(() => setNoveltyReady(true));
  }, [workspace?.novelty_id]);
  useEffect(() => {
    const match = versions.find((item) => item.artifact_id === workspace?.design_version_id);
    if (match && match.payload.goal.trim() === workspace?.design_idea.trim()) {
      setDesign(match.payload); setCurrentVersion(match.version_id);
    }
    else if (workspace) { setDesign(null); setCurrentVersion(null); }
  }, [workspace?.design_version_id, versions]);
  useEffect(() => {
    if (tab === "novelty" && !novelty && design && noveltyReady) setTab("canvas");
    if (tab === "canvas" && !design && novelty) setTab("novelty");
  }, [novelty, design, tab, noveltyReady]);
  async function scan() {
    setBusy(true); setError("");
    try { const artifact = await postJson<Artifact<Novelty>>("/api/research/novelty", { query: idea.trim() }); setNovelty(artifact.payload); setTab("novelty"); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "检索失败"); }
    finally { setBusy(false); }
  }
  async function generate(action = "generate", nodeId?: string, instruction = "") {
    setBusy(true); setError("");
    try { const artifact = await postJson<Artifact<Design> & {version?: DesignVersion}>("/api/research/design", { goal: idea.trim(), constraints, action,
      current_design: action === "generate" ? null : design, node_id: nodeId, instruction }); setDesign(artifact.payload); setTab("canvas");
      if (artifact.version) { setVersions((items) => [artifact.version!, ...items]); setCurrentVersion(artifact.version.version_id); }
      await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "方案生成失败"); }
    finally { setBusy(false); }
  }
  async function restoreVersion(version: DesignVersion) {
    setBusy(true); setError("");
    try { const restored = await apiJson<DesignVersion>(`/api/research/design/versions/${version.version_id}/restore`, {method: "POST"});
      setDesign(restored.payload); setCurrentVersion(restored.version_id); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "版本恢复失败"); }
    finally { setBusy(false); }
  }
  const activeVersion = versions.find((item) => item.version_id === currentVersion);
  const priorVersion = versions.find((item) => item.number === (activeVersion?.number || 1) - 1);
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
    try { const saved = await importWork(paper); const ids = workspace?.selected_paper_ids || [];
      if (!ids.includes(saved.id)) await updateWorkspace({selected_paper_ids: [...ids, saved.id].slice(0, 5)});
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "加入对比失败"); }
    finally { setBusy(false); }
  }
  return <><ResearchNav current="/design" /><main className="researchPage">
    <div className="pageIntro"><div className="eyebrow">04 / DESIGN</div><h1>让研究想法成为可检验的方案。</h1><p>先依据检索摘要做定性新颖性扫描，再生成可拖动的研究设计图。相似程度只有高、中、低，不代表精确评分或已读全文。</p></div>
    <section className="sectionBox"><label className="fieldLabel" htmlFor="idea">我的研究想法</label><textarea id="idea" className="largeTextarea" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="例如：用更低成本的单细胞方法识别治疗前肿瘤耐药亚群" /><label className="fieldLabel" htmlFor="constraints" style={{ marginTop: 15 }}>约束条件（可选）</label><input id="constraints" className="largeInput" value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="经费、样本量、数据来源、周期等" /><div className="actionRow"><button className="primaryButton" disabled={busy || idea.trim().length < 5} onClick={scan}>{busy ? "分析中…" : "检索相似研究"}</button><button disabled={busy || idea.trim().length < 5} onClick={() => generate()}>生成研究设计 →</button></div></section>
    {!novelty && !design && !busy && <section className="startGuide" aria-label="科研设计使用引导"><div className="startGuideIntro"><span>START HERE</span><h2>把一个想法，推进为可核验的研究路径。</h2><p>先填入自己的研究问题。你可以检索相似研究，也可以直接生成设计草稿；两项结果会清楚标注证据范围。</p><div className="sampleIdeas"><b>试一个示例</b>{["如何降低肿瘤单细胞测序的样本与计算成本？", "如何验证新型电池材料在高温下的长期稳定性？", "如何评估教育干预对不同地区学生的长期影响？"].map((sample) => <button key={sample} onClick={() => { setIdea(sample); document.getElementById("idea")?.focus(); }}>{sample} ↗</button>)}</div></div><div className="startGuideSteps"><div><b>01</b><strong>提出问题</strong><small>明确对象、变量与目标</small></div><div><b>02</b><strong>核对相似研究</strong><small>基于摘要做定性扫描</small></div><div><b>03</b><strong>搭建设计草稿</strong><small>检查对照、读数与假设</small></div></div></section>}
    {error && <div className="researchError" role="alert">{error}</div>}
    {busy && <StepLoading title="正在处理研究设计" steps={["读取研究想法和约束", "检索相关摘要或调整结构化设计", "组织节点与证据边界"]} />}
    {busy && <div className="floatingBusy" role="status"><span className="loadingPulse"/>正在处理，完成后会自动更新当前工作区</div>}
    {(novelty || design) && <div className="resultBar"><strong>工作区</strong><div className="tabBar"><button className={tab === "novelty" ? "active" : ""} onClick={() => setTab("novelty")}>新颖性扫描</button><button className={tab === "canvas" ? "active" : ""} onClick={() => setTab("canvas")}>设计沙盘</button></div></div>}
    {tab === "novelty" && novelty && <section className="sectionBox"><h2>新颖性扫描 <small style={{ fontSize: 12, color: "#809486" }}>整体相似：{novelty.similarity_level}</small></h2><NoveltySpace novelty={novelty} busy={busy} onView={viewWork} onAdd={addWork} /><button className="primaryButton" style={{ marginTop: 20 }} disabled={busy} onClick={() => generate()}>基于这个想法生成方案 →</button></section>}
    {tab === "canvas" && design && <><div className="versionBar"><strong>当前版本 V{activeVersion?.number || 1}</strong><div>{versions.slice().reverse().map((item) => <button className={item.version_id === currentVersion ? "active" : ""} key={item.version_id} disabled={busy} onClick={() => restoreVersion(item)}>V{item.number} · {item.action}</button>)}</div>{priorVersion && <button onClick={() => restoreVersion(priorVersion)} disabled={busy}>撤回上一版本</button>}</div><div className="designGrid"><section className="sectionBox designSidebar" style={{ marginTop: 0 }}><div className="designSideHeader"><span>方案概览</span><h2>设计调整</h2><p title={design.goal}>{design.goal}</p></div><div className="designSummary"><b>本版思路</b><p>{design.change_summary || "当前为方案草稿。"}</p><details><summary>阅读完整说明</summary><p>{design.change_summary || "当前为方案草稿。"}</p></details></div><div className="designActions"><b>调整方向</b><div className="actionRow">{actions.map(([action, label]) => <button key={action} disabled={busy} onClick={() => generate(action)}>{label}</button>)}</div></div><details className="designDetails"><summary>本次修改 <small>{activeVersion ? activeVersion.changes.added.length + activeVersion.changes.removed.length + activeVersion.changes.modified.length : 0} 项</small></summary><div className="versionChanges">{activeVersion ? <>{activeVersion.changes.added.map((item) => <button key={`a${item}`} onClick={() => openChange(item, "新增")}>＋ {item} ↗</button>)}{activeVersion.changes.removed.map((item) => <button key={`r${item}`} onClick={() => openChange(item, "移除")}>－ {item} ↗</button>)}{activeVersion.changes.modified.map((item) => <button key={`m${item}`} onClick={() => openChange(item, "修改")}>◌ {item} ↗</button>)}</> : "初始方案"}</div></details><details className="designDetails"><summary>对照与评价 <small>{design.controls.length + design.readouts.length} 项</small></summary><h4>对照</h4><ul>{design.controls.map((item, i) => <li key={i}>{item}</li>)}</ul><h4>评价指标</h4><ul>{design.readouts.map((item, i) => <li key={i}>{item}</li>)}</ul></details><details className="designDetails"><summary>关键假设 <small>{design.assumptions.length} 项</small></summary><ul>{design.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></details></section><section><DesignFlow design={design} onSelectNode={setSelectedNode} /><p className="miniNotice">拖动或点击节点，查看并局部优化方案。具体参数需预实验、功效分析或领域专家核对。</p></section></div>{nodeDetail && <EvidenceDrawer title={nodeDetail.label} eyebrow="研究设计节点" onClose={() => setSelectedNode(null)}><p>{nodeDetail.detail}</p><div className="nodeRelations"><strong>连接逻辑</strong>{design.edges.filter((edge) => edge.source === nodeDetail.id || edge.target === nodeDetail.id).map((edge, index) => <p key={index}>{edge.label || `${design.nodes.find((item) => item.id === edge.source)?.label || edge.source} → ${design.nodes.find((item) => item.id === edge.target)?.label || edge.target}`}</p>)}</div><dl><dt>节点类型</dt><dd>{nodeDetail.type}</dd><dt>版本</dt><dd>V{activeVersion?.number || 1}</dd></dl><label className="fieldLabel">希望怎样修改这个节点？</label><textarea className="largeTextarea" value={nodeInstruction} onChange={(e) => setNodeInstruction(e.target.value)} placeholder="例如：改用成本更低的数据来源，并保持评估目标不变" /><button className="drawerAction" disabled={busy || !nodeInstruction.trim()} onClick={() => generate("node", nodeDetail.id, nodeInstruction)}>AI 优化此节点 →</button></EvidenceDrawer>}{selectedChange && <EvidenceDrawer title={selectedChange.label} eyebrow={`版本差异 · ${selectedChange.kind}`} onClose={() => setSelectedChange(null)}><p>这条记录属于 V{activeVersion?.number || 1} 的版本变化。当前方案中没有同名节点；可切换历史版本查看当时的完整结构。</p></EvidenceDrawer>}</>}
  </main></>;
}
