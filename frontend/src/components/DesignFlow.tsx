"use client";

import { useEffect, useState } from "react";
import DesignInsights from "./DesignInsights";
import "./experiment-route.css";

export type Step = { name: string; purpose?: string; method?: string; controls?: string; readouts?: string };
type Node = { id: string; label: string; type: string; detail: string; steps?: Step[] };
type Design = { nodes: Node[]; edges: { source: string; target: string; label: string }[] };

function iconType(node: Node): "database" | "cell" | "animal" | "analysis" | "generic" {
  // Only classify the stated step name: a conditional mention in a long
  // description does not establish that an animal or cell experiment is used.
  const text = node.label.toLowerCase();
  if (/数据库|geo\b|tcga\b/.test(text)) return "database";
  if (/小鼠|动物实验|动物模型/.test(text)) return "animal";
  if (/细胞实验|细胞系|细胞培养|细胞干预/.test(text)) return "cell";
  if (/分析|测序|筛选|富集/.test(text)) return "analysis";
  return "generic";
}

function StageIcon({ kind }: { kind: ReturnType<typeof iconType> }) {
  if (kind !== "generic") return <span aria-hidden="true" className={`er-art er-art-${kind}`} />;
  return <svg viewBox="0 0 72 72" aria-hidden="true" className="er-icon"><rect x="15" y="14" width="42" height="44" rx="10" fill="#edf3fb" stroke="#7d9bc1" strokeWidth="2"/><path d="M25 27h22M25 36h22M25 45h14" stroke="#5b7ea8" strokeWidth="3" strokeLinecap="round"/></svg>;
}
export default function DesignFlow({ design, artifactId, onSelectNode, onExpandNode, onAddStep, onRemoveStep, busy = false }: { design: Design; artifactId: string; onSelectNode?: (id: string) => void; onExpandNode?: (id: string) => void; onAddStep?: (id: string, step: Step) => Promise<void>; onRemoveStep?: (id: string, index: number) => Promise<void>; busy?: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [insight, setInsight] = useState<"review" | "outcomes" | null>(null);
  const [adding, setAdding] = useState(false);
  const [step, setStep] = useState<Step>({name:"", purpose:"", method:"", controls:"", readouts:""});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  useEffect(() => { setExpanded(null); setInsight(null); setAdding(false); setStep({name:"", purpose:"", method:"", controls:"", readouts:""}); setSaveError(""); }, [artifactId]);
  async function saveStep() {
    if (!expanded || !step.name.trim() || !onAddStep) return;
    setSaving(true); setSaveError("");
    try { await onAddStep(expanded, {...step, name:step.name.trim()}); setAdding(false); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  async function removeStep(index: number) {
    if (!expanded || !onRemoveStep) return;
    setSaving(true); setSaveError("");
    try { await onRemoveStep(expanded, index); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  const active = design.nodes.find(n => n.id === expanded);
  const related = active ? design.edges.filter(e => e.source === active.id || e.target === active.id) : [];
  const names = new Map(design.nodes.map(n => [n.id, n.label]));
  return <section className="er-route" aria-label="实验设计路线">
    <header className="er-head"><div><span>RESEARCH ROUTE</span><h2>实验设计路线</h2><p>先看阶段，再展开具体实验；连接关系以方案中已有的描述为准。</p></div><button type="button" onClick={() => { setExpanded(null); setInsight(insight === "review" && !expanded ? null : "review"); }}>整体方案检查</button></header>
    {insight === "review" && !active && artifactId && <DesignInsights artifactId={artifactId} nodes={design.nodes} onSelectNode={id => { setExpanded(id); setInsight(null); }} initialTab="review" />}
    <div className="er-stages">{design.nodes.map((node, index) => { const next = design.edges.filter(edge => edge.source === node.id); return <button type="button" key={node.id} className={`er-stage${expanded === node.id ? " is-active" : ""}`} aria-expanded={expanded === node.id} onClick={() => { setExpanded(expanded === node.id ? null : node.id); setInsight(null); }}><StageIcon kind={iconType(node)} /><span className="er-number">阶段 {String(index + 1).padStart(2, "0")}</span><strong>{node.label}</strong>{next.length > 0 && <span className="er-next">连接 → {names.get(next[0].target) || next[0].target}{next.length > 1 ? ` 等 ${next.length} 项` : ""}</span>}<small>{expanded === node.id ? "收起内容 −" : "展开实验内容 +"}</small></button>; })}</div>
    {design.edges.length > 0 && <details className="er-map"><summary>查看方案中的 {design.edges.length} 条阶段连接</summary><div>{design.edges.map((edge, index) => <p key={index}><span>{names.get(edge.source) || edge.source}</span><b>→</b><span>{names.get(edge.target) || edge.target}</span>{edge.label && <small>{edge.label}</small>}</p>)}</div></details>}
    {active && <section className="er-detail"><div className="er-detail-head"><div><span>阶段详情</span><h3>{active.label}</h3></div><button type="button" onClick={() => setExpanded(null)}>收起</button></div><p className="er-purpose">{active.detail || "此阶段尚未提供详细目的，请补充后再评估。"}</p>
      {active.steps?.length ? <div className="er-experiments">{active.steps.map((step, i) => <article key={i}><div className="er-experiment-title"><StageIcon kind={iconType({id:"", label:step.name, detail:step.method || "", type:""})} /><div><span>实验 / 分析 {String(i + 1).padStart(2, "0")}</span><h4>{step.name}</h4></div></div><dl>{[["目的",step.purpose],["操作思路",step.method],["对照",step.controls],["检测指标",step.readouts]].map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value?.trim() || "待补充或核对"}</dd></div>)}</dl><button type="button" className="er-remove" disabled={saving} onClick={() => removeStep(i)} aria-label={`删除实验 ${step.name}`}>删除此实验并保存新版本</button></article>)}</div> : <p className="er-missing">当前版本没有记录可展开的具体实验。可以编辑此阶段补充说明，或重新生成新版方案；系统不会凭空补造已有步骤。</p>}
      {saveError && !adding && <p role="alert" className="er-missing">{saveError}</p>}
      {related.length > 0 && <div className="er-links"><strong>与其他阶段的关系</strong>{related.map((edge,i) => <p key={i}>{names.get(edge.source) || edge.source} → {names.get(edge.target) || edge.target}{edge.label ? `：${edge.label}` : ""}</p>)}</div>}
      <div className="er-actions"><button type="button" onClick={() => onSelectNode?.(active.id)}>编辑此阶段 ↗</button><button type="button" onClick={() => { setAdding(!adding); setSaveError(""); }}>手动添加实验</button>{!active.steps?.length && <button type="button" disabled={busy} onClick={() => onExpandNode?.(active.id)}>用 AI 补充此阶段实验</button>}<button type="button" onClick={() => setInsight(insight === "review" ? null : "review")}>检查方案</button><button type="button" onClick={() => setInsight(insight === "outcomes" ? null : "outcomes")}>推演此阶段结果</button></div>
      {adding && <div className="er-add"><strong>添加到「{active.label}」</strong><p>保存后生成新版本；没有确定的信息可以留空。</p>{([["name","实验名称"],["purpose","目的"],["method","操作思路"],["controls","对照"],["readouts","检测指标"]] as const).map(([key,label]) => <label key={key}>{label}<input value={step[key] || ""} maxLength={key === "name" ? 200 : 2000} onChange={e => setStep(s => ({...s,[key]:e.target.value}))} /></label>)}{saveError && <p role="alert">{saveError}</p>}<button type="button" disabled={saving || !step.name.trim()} onClick={saveStep}>{saving ? "保存中…" : "保存为新版本"}</button></div>}
      {insight && artifactId && <DesignInsights key={`${artifactId}:${active.id}:${insight}`} artifactId={artifactId} nodes={design.nodes} onSelectNode={id => { setExpanded(id); setInsight(null); }} initialTab={insight} initialNodeId={active.id} />}
    </section>}
    <p className="er-foot">草稿需结合原文、具体条件和领域专家核查；图形仅表示类别，不代表实验结果。</p>
  </section>;
}
