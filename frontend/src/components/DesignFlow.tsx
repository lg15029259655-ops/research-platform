"use client";

import { useEffect, useState } from "react";
import DesignInsights from "./DesignInsights";
import { experimentCategory as iconType, effectiveCategory, CATEGORY_OPTIONS, type ExperimentCategory } from "./experimentCategory";
import "./experiment-route.css";

export type Step = { name: string; purpose?: string; method?: string; controls?: string; readouts?: string; icon_category?: ExperimentCategory | null };
type Node = { id: string; label: string; type: string; detail: string; steps?: Step[] };
type Edge = { source: string; target: string; label: string };
type Design = { nodes: Node[]; edges: Edge[] };
type Kind = ExperimentCategory | "heatmap" | "volcano" | "immune" | "sequencing";

function StageIcon({ kind }: { kind: Kind }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (CATEGORY_OPTIONS.some(([category]) => category === kind)) return <span aria-hidden="true" className={`er-symbol er-illustration er-illustration-${kind}`} />;
  return <span className={`er-symbol er-symbol-${kind}`} aria-hidden="true"><svg viewBox="0 0 64 64" {...common}>
    {kind === "database" && <><ellipse cx="32" cy="16" rx="19" ry="7" fill="#d4e9f8"/><path d="M13 16v27c0 4 8 7 19 7s19-3 19-7V16M13 29c0 4 8 7 19 7s19-3 19-7M13 41c0 4 8 7 19 7s19-3 19-7"/></>}
    {kind === "heatmap" && <><path d="M13 50V13h38" opacity=".45"/>{[0,1,2,3].flatMap(y => [0,1,2,3].map(x => <rect key={`${x}-${y}`} x={18+x*8} y={16+y*8} width="7" height="7" rx="1" fill={[["#507cb1","#a4c7d9","#e9c179","#df8468"],["#6a9cbd","#d6d9ae","#e99b76","#e4be7d"],["#d9dcae","#df987f","#638bb8","#a8ccdc"],["#edb580","#dfa190","#aacbd7","#5b80ad"]][y][x]} stroke="none"/>))}</>}
    {kind === "volcano" && <><path d="M12 12v40h40M32 50V31M16 29h34" opacity=".55"/><g fill="#d57862" stroke="none">{[[17,18],[21,23],[24,30],[28,35],[36,38],[40,30],[44,23],[49,16],[34,41],[19,35]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="2.5"/>)}</g></>}
    {kind === "pathway" && <><path d="M17 19l14 10 15-13M31 29l-8 17M31 29l17 15"/><g fill="#d9eedf"><circle cx="17" cy="19" r="6"/><circle cx="31" cy="29" r="6"/><circle cx="46" cy="16" r="6"/><circle cx="23" cy="46" r="6"/><circle cx="48" cy="44" r="6"/></g></>}
    {kind === "immune" && <><path d="M32 10l17 7v13c0 11-7 18-17 23-10-5-17-12-17-23V17z" fill="#e2eafa"/><circle cx="32" cy="29" r="8"/><path d="M32 17v4m0 16v4M20 29h4m16 0h4M24 21l3 3m10 10l3 3m0-16l-3 3m-10 10l-3 3"/></>}
    {kind === "cell" && <><circle cx="32" cy="32" r="22" fill="#e7f1e9"/><circle cx="33" cy="31" r="8" fill="#add4bf"/><path d="M18 26c2-3 4-3 6-2m18 14c3-2 5-2 7 1M22 42c2 1 4 1 5-1M40 20c2-1 4 0 5 2"/></>}
    {kind === "gene" && <><path d="M19 11c0 19 26 21 26 42M45 11c0 19-26 21-26 42M22 18h20M25 25h14M26 38h12M22 46h20"/><path d="M45 25l7-4m-6 8l8 1" stroke="#dc856e"/></>}
    {kind === "animal" && <><path d="M13 39c0-10 8-16 19-16 9 0 15 5 18 12l5 3-5 4-4 8H22l-3-6-6-2z" fill="#eee6d9"/><circle cx="27" cy="22" r="6" fill="#f4e9dd"/><circle cx="45" cy="35" r="1.5" fill="currentColor"/><path d="M13 40c-7-1-8-7-4-9M23 50v4m17-4v4"/></>}
    {kind === "sequencing" && <><path d="M17 10c1 16 29 26 30 44M47 10C46 26 18 36 17 54M20 17h24M23 24h18M27 32h10M23 40h18M20 47h24"/><circle cx="51" cy="16" r="4" fill="#e8b281"/></>}
    {kind === "microscope" && <><path d="M25 12l8-3 7 16-8 3zM29 28l-3 5m-7 2h19M22 35c1 8 6 11 13 11 8 0 13-6 13-14M16 52h35M22 46h23"/><circle cx="46" cy="29" r="4" fill="#d9e9f5"/></>}
    {kind === "analysis" && <><path d="M13 12v40h40M20 44V34h7v10M31 44V25h7v19M42 44V17h7v27" fill="#dceaf4"/><path d="M20 27l10-7 9 2 11-10" stroke="#d78169"/></>}
    {kind === "goal" && <><circle cx="32" cy="32" r="21"/><circle cx="32" cy="32" r="13"/><circle cx="32" cy="32" r="5" fill="#e8a886"/><path d="M35 29l15-15m-5 0h5v5"/></>}
    {kind === "sample" && <><path d="M21 12h22M24 12v12l-8 21c-1 4 2 7 6 7h20c4 0 7-3 6-7l-8-21V12"/><path d="M20 38h24l3 8c1 3-1 4-4 4H21c-3 0-5-1-4-4z" fill="#cce7e7"/><circle cx="30" cy="43" r="2" fill="#7fb6bb"/></>}
    {kind === "constraint" && <><rect x="14" y="15" width="36" height="36" rx="10" fill="#f4ecde"/><path d="M32 22v12m0 7v1" stroke="#b68b55" strokeWidth="3"/></>}
    {kind === "control" && <><path d="M18 15v32M46 15v32M12 21h12M40 21h12M12 42h12M40 42h12"/><circle cx="18" cy="29" r="4" fill="#afd6d0"/><circle cx="46" cy="36" r="4" fill="#efc49f"/></>}
    {kind === "generic" && <><rect x="14" y="16" width="36" height="32" rx="8" fill="#edf3f8"/><path d="M23 26h18M23 33h18M23 40h11"/></>}
  </svg></span>;
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
  const names = new Map(design.nodes.map(n => [n.id, n.label]));
  function select(id: string) { setExpanded(expanded === id ? null : id); setInsight(null); setAdding(false); setSaveError(""); }
  function jump(id: string) { setExpanded(id); setInsight(null); setAdding(false); document.getElementById(`er-node-${id}`)?.scrollIntoView({behavior:"smooth", block:"center"}); }
  return <section className="er-route" aria-label="实验设计路线">
    <header className="er-head"><div><span>RESEARCH ROUTE / 实验路线</span><h2>从研究问题到验证</h2><p>沿连接线查看方案，展开阶段即可在原处查看具体实验。</p></div><button type="button" onClick={() => { setExpanded(null); setInsight(insight === "review" && !expanded ? null : "review"); }}>整体方案检查 ↗</button></header>
    {insight === "review" && !expanded && artifactId && <DesignInsights artifactId={artifactId} nodes={design.nodes} onSelectNode={jump} initialTab="review" />}
    <div className="er-route-key"><span><i/> 方案阶段</span><span>→ 方案中已有的连接</span><span>图形表示实验类型</span></div>
    <details className="er-library"><summary>查看常用研究图形分类</summary><p>同一类研究活动使用相同图形；图片是类别标记，不代表实际结果。</p><div className="er-library-grid">{CATEGORY_OPTIONS.map(([kind,label]) => <div key={kind}><StageIcon kind={kind} /><span>{label}</span></div>)}</div></details>
    <div className="er-stages">{design.nodes.map((node, index) => {
      const open = expanded === node.id;
      const outgoing = design.edges.filter(e => e.source === node.id);
      const incoming = design.edges.filter(e => e.target === node.id);
      const nextNode = design.nodes[index + 1];
      const nextEdge = nextNode && outgoing.find(e => e.target === nextNode.id);
      const otherEdges = outgoing.filter(e => e !== nextEdge);
      const previews = node.steps || [];
      return <div className="er-stage-group" key={node.id} id={`er-node-${node.id}`}>
        <article className={`er-stage${open ? " is-active" : ""}`}>
          <button type="button" className="er-stage-main" aria-expanded={open} onClick={() => select(node.id)}>
            <span className="er-index">{String(index + 1).padStart(2,"0")}</span><StageIcon kind={iconType(node.label)} /><span className="er-stage-copy"><span className="er-number">研究环节{incoming.length > 1 ? ` · ${incoming.length} 条关联` : ""}</span><strong>{node.label}</strong><span className="er-stage-meta">{previews.length ? `${previews.length} 项实验 / 分析` : "查看环节说明"}</span></span><span className="er-toggle">{open ? "收起 −" : "展开 +"}</span>
          </button>
          {!open && previews.length > 0 && <div className="er-preview" aria-label={`${node.label}包含的实验`}>{previews.map((item,i) => <button type="button" key={i} className="er-preview-item" onClick={() => select(node.id)}><StageIcon kind={effectiveCategory(item.name, item.icon_category)} /><span>{item.name}</span></button>)}</div>}
          {open && <section className="er-detail" aria-label={`${node.label}的实验详情`}>
            {node.detail && <details className="er-stage-description"><summary>查看环节说明</summary><p>{node.detail}</p></details>}
            {previews.length ? <div className="er-experiments">{previews.map((item, i) => { const shown = effectiveCategory(item.name, item.icon_category); return <article key={i}><div className="er-experiment-title"><StageIcon kind={shown} /><div><span>实验 / 分析 {String(i + 1).padStart(2,"0")}</span><h4>{item.name}</h4></div></div><details><summary>查看目的、方法与对照</summary><dl>{[["目的",item.purpose],["操作思路",item.method],["对照",item.controls],["检测指标",item.readouts]].map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value?.trim() || "待补充或核对"}</dd></div>)}</dl><button type="button" className="er-remove" disabled={saving} onClick={() => removeStep(i)} aria-label={`删除实验 ${item.name}`}>删除此实验并保存新版本</button></details></article>; })}</div> : <p className="er-missing">此版本还没有记录具体实验。可手动添加，或让 AI 补充此阶段；不会将示例当作已有方案。</p>}
            {saveError && !adding && <p role="alert" className="er-missing">{saveError}</p>}
            <div className="er-actions"><button type="button" onClick={() => setInsight(insight === "review" ? null : "review")}>检查方案</button><button type="button" onClick={() => setInsight(insight === "outcomes" ? null : "outcomes")}>推演此阶段结果</button>{!previews.length && <button type="button" disabled={busy} onClick={() => onExpandNode?.(node.id)}>AI 补充实验</button>}<details className="er-more"><summary>编辑与添加</summary><div><button type="button" onClick={() => onSelectNode?.(node.id)}>编辑阶段</button><button type="button" onClick={() => { setAdding(!adding); setSaveError(""); }}>＋ 添加实验</button></div></details></div>
            {adding && <div className="er-add"><strong>添加到「{node.label}」</strong><p>保存后生成新版本；没有确定的信息可以留空。</p>{([["name","实验名称"],["purpose","目的"],["method","操作思路"],["controls","对照"],["readouts","检测指标"]] as const).map(([key,label]) => <label key={key}>{label}<input value={step[key] || ""} maxLength={key === "name" ? 200 : 2000} onChange={e => setStep(s => ({...s,[key]:e.target.value}))} /></label>)}{saveError && <p role="alert">{saveError}</p>}<button type="button" disabled={saving || !step.name.trim()} onClick={saveStep}>{saving ? "保存中…" : "保存为新版本"}</button></div>}
            {insight && artifactId && <DesignInsights key={`${artifactId}:${node.id}:${insight}`} artifactId={artifactId} nodes={design.nodes} onSelectNode={jump} initialTab={insight} initialNodeId={node.id} />}
          </section>}
          {otherEdges.length > 0 && <div className="er-branches"><span>连接至</span>{otherEdges.map((edge,i) => <button type="button" key={i} onClick={() => names.has(edge.target) && jump(edge.target)}>↗ {names.get(edge.target) || edge.target}{edge.label && <small> · {edge.label}</small>}</button>)}</div>}
        </article>
        {nextNode && <div className={`er-connector${nextEdge ? "" : " is-unlinked"}`}>{nextEdge ? <><span>↓</span><b>{nextEdge.label || "下一环节"}</b></> : <small>独立环节</small>}</div>}
      </div>;
    })}</div>
    {design.edges.length > 0 && <details className="er-map"><summary>查看全部 {design.edges.length} 条连接</summary><div>{design.edges.map((edge, index) => <p key={index}><span>{names.get(edge.source) || edge.source}</span><b>→</b><span>{names.get(edge.target) || edge.target}</span>{edge.label && <small>{edge.label}</small>}</p>)}</div></details>}
    <p className="er-foot">方案为研究草稿，需结合原文、具体条件和领域专家核查；图形仅表示类型，不代表实验结果。</p>
  </section>;
}
