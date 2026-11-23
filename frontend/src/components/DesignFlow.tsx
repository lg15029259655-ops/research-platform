"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import DesignInsights from "./DesignInsights";
import ExperimentIcon from "./experiment/ExperimentIcon";
import { specificMethodCategory, stageIllustrationCategory } from "@/lib/experiment-categories";
import { readTabDraft, useTabDraft } from "@/lib/tab-draft";
import { readManualDesignReceipt } from "@/lib/manual-design";
import { effectiveCategory, type ExperimentCategory } from "./experimentCategory";
import "./experiment-route.css";

export type Step = { name: string; purpose?: string; method?: string; controls?: string; readouts?: string; icon_category?: ExperimentCategory | null };
type Node = { id: string; label: string; type: string; detail: string; steps?: Step[] };
type Edge = { source: string; target: string; label: string };
type Design = { goal?: string; nodes: Node[]; edges: Edge[] };
type StageDraft = { step: Step; requestId?: string };
const stepFields = [["name", "实验名称"], ["purpose", "目的"], ["method", "操作思路"],
  ["controls", "对照"], ["readouts", "检测指标"]] as const;
function StageIcon({ kind, name, stage = false }: { kind: ExperimentCategory; name: string; stage?: boolean }) {
  const method = (stage && stageIllustrationCategory(name)) || specificMethodCategory(name);
  if (method) return <span className="er-symbol"><ExperimentIcon key={method} category={method} size={58} /></span>;
  return <span aria-hidden="true" className={`er-symbol er-illustration er-illustration-${kind}`} />;
}

export default function DesignFlow({ design, artifactId, onSelectNode, onExpandNode, onAddStep, onRemoveStep, busy = false, readOnly = false }: { design: Design; artifactId: string; onSelectNode?: (id: string) => void; onExpandNode?: (id: string) => void; onAddStep?: (id: string, step: Step, requestId: string) => Promise<void>; onRemoveStep?: (id: string, index: number) => Promise<void>; busy?: boolean; readOnly?: boolean }) {
  const [savedStage, setExpanded] = useTabDraft<string>(artifactId ? `design-stage:${artifactId}` : null);
  const expanded = design.nodes.some((node) => node.id === savedStage) ? savedStage : null;
  const [insight, setInsight] = useState<"review" | "outcomes" | null>(null);
  const draftKey = expanded && artifactId && !readOnly ? `design-stage-draft:${JSON.stringify([artifactId, expanded])}` : null;
  const [draft, setDraft] = useTabDraft<StageDraft>(draftKey);
  const [addingOverride, setAdding] = useState<boolean | null>(null);
  const adding = addingOverride ?? !!draft;
  const step: Step = draft?.step ?? { name: "" };
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<{ draftKey: string; message: string } | null>(null);
  const stageButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusStageOnOpen = useRef<string | null>(null);
  const focusNameOnOpen = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const saveError = saveFailure?.draftKey === draftKey ? saveFailure.message : "";
  function focusStage(id: string) {
    const button = stageButtons.current.get(id);
    if (!button) return;
    button.focus({ preventScroll: true });
    button.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "center",
    });
  }
  useLayoutEffect(() => {
    if (!expanded || focusStageOnOpen.current !== expanded) return;
    focusStageOnOpen.current = null;
    focusStage(expanded);
  }, [expanded]);
  useLayoutEffect(() => {
    if (!adding || !focusNameOnOpen.current) return;
    focusNameOnOpen.current = false;
    nameInput.current?.focus();
  }, [adding]);
  useEffect(() => { setInsight(null); setAdding(null); setSaveFailure(null); }, [artifactId]);
  useEffect(() => {
    if (!draftKey) return;
    const requestId = readTabDraft<StageDraft>(draftKey)?.requestId;
    if (!requestId) return;
    void readManualDesignReceipt(requestId).then(() => {
      if (readTabDraft<StageDraft>(draftKey)?.requestId === requestId) setDraft(null);
    }).catch(() => {});
  }, [draftKey, setDraft]);

  function editStep(field: typeof stepFields[number][0], value: string) {
    if (!draftKey) return;
    setAdding(true);
    const previous = readTabDraft<StageDraft>(draftKey);
    const next = { name: "", ...previous?.step, [field]: value };
    setDraft(stepFields.some(([key]) => next[key]) ? { step: next } : null);
  }

  async function saveStep() {
    if (!expanded || !draftKey || !step.name.trim() || !onAddStep || saving) return;
    const requestId = draft?.requestId ?? crypto.randomUUID();
    setDraft({ step, requestId });
    setSaving(true); setSaveFailure(null);
    try {
      await onAddStep(expanded, { ...step, name: step.name.trim() }, requestId);
      if (readTabDraft<StageDraft>(draftKey)?.requestId === requestId) setDraft(null);
      setAdding(null);
    }
    catch (error) { setSaveFailure({ draftKey, message: error instanceof Error ? error.message : "保存失败，请重试" }); }
    finally { setSaving(false); }
  }
  async function removeStep(index: number) {
    if (!expanded || !draftKey || !onRemoveStep) return;
    setSaving(true); setSaveFailure(null);
    try { await onRemoveStep(expanded, index); }
    catch (error) { setSaveFailure({ draftKey, message: error instanceof Error ? error.message : "保存失败，请重试" }); }
    finally { setSaving(false); }
  }
  const names = new Map(design.nodes.map(n => [n.id, n.label]));
  function select(id: string | null) { setExpanded(id); setInsight(null); setAdding(null); setSaveFailure(null); }
  function jump(id: string) {
    if (!stageButtons.current.has(id)) return;
    if (expanded === id) focusStage(id);
    else focusStageOnOpen.current = id;
    select(id);
  }
  return <section className="er-route" aria-label="实验设计路线">
    <header className="er-head"><div><span>RESEARCH ROUTE / 实验路线</span><h2>从研究问题到验证</h2></div>{!readOnly && <button type="button" onClick={() => { setExpanded(null); setInsight(insight === "review" && !expanded ? null : "review"); }}>整体方案检查 ↗</button>}</header>
    {insight === "review" && !expanded && artifactId && <DesignInsights artifactId={artifactId} nodes={design.nodes} onSelectNode={jump} initialTab="review" />}
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
          <button type="button" className="er-stage-main" aria-expanded={open} ref={(button) => {
            if (button) stageButtons.current.set(node.id, button);
            else stageButtons.current.delete(node.id);
          }} onClick={() => select(open ? null : node.id)}>
            <span className="er-index">{String(index + 1).padStart(2,"0")}</span><StageIcon stage name={node.label} kind={effectiveCategory(node.label, null, design.goal)} /><span className="er-stage-copy"><span className="er-number">研究环节{incoming.length > 1 ? ` · ${incoming.length} 条关联` : ""}</span><strong>{node.label}</strong><span className="er-stage-meta">{previews.length ? `${previews.length} 项实验 / 分析` : "查看环节说明"}</span></span><span className="er-toggle">{open ? "收起 −" : "展开 +"}</span>
          </button>
          {!open && previews.length > 0 && <div className="er-preview" aria-label={`${node.label}包含的实验`}>{previews.map((item,i) => <button type="button" key={i} className="er-preview-item" onClick={() => jump(node.id)}><StageIcon name={item.name} kind={effectiveCategory(item.name, item.icon_category, design.goal)} /><span>{item.name}</span></button>)}</div>}
          {open && <section className="er-detail" aria-label={`${node.label}的实验详情`}>
            {node.detail && <details className="er-stage-description"><summary>查看环节说明</summary><p>{node.detail}</p></details>}
            {previews.length ? <div className="er-experiments">{previews.map((item, i) => { const shown = effectiveCategory(item.name, item.icon_category, design.goal); return <article key={i}><div className="er-experiment-title"><StageIcon name={item.name} kind={shown} /><div><span>实验 / 分析 {String(i + 1).padStart(2,"0")}</span><h4>{item.name}</h4></div></div><details><summary>查看目的、方法与对照</summary><dl>{[["目的",item.purpose],["操作思路",item.method],["对照",item.controls],["检测指标",item.readouts]].map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value?.trim() || "待补充或核对"}</dd></div>)}</dl>{!readOnly && <button type="button" className="er-remove" disabled={saving} onClick={() => removeStep(i)} aria-label={`删除实验 ${item.name}`}>删除此实验并保存新版本</button>}</details></article>; })}</div> : <p className="er-missing">{readOnly ? "此版本还没有记录具体实验。" : "此版本还没有记录具体实验。可手动添加，或让 AI 补充此阶段；不会将示例当作已有方案。"}</p>}
            {saveError && !adding && <p role="alert" className="er-missing">{saveError}</p>}
            {!readOnly && <div className="er-actions"><button type="button" onClick={() => setInsight(insight === "outcomes" ? null : "outcomes")}>推演此阶段结果</button><button type="button" aria-expanded={adding} onClick={() => {
              focusNameOnOpen.current = !adding;
              setAdding(!adding);
              setSaveFailure(null);
            }}>{adding ? "收起添加" : draft ? "继续实验草稿" : "＋ 添加实验"}</button>{!previews.length && <button type="button" disabled={busy} onClick={() => onExpandNode?.(node.id)}>AI 补充实验</button>}<button type="button" onClick={() => onSelectNode?.(node.id)}>编辑阶段</button></div>}
            {!readOnly && adding && <div className="er-add"><strong>添加到「{node.label}」</strong><p>草稿保留在当前标签页。保存后生成新版本，未确定的说明可以留空。</p>
              {stepFields.map(([key, label]) => <label key={key}>{label}
                <input ref={key === "name" ? nameInput : undefined} value={step[key] || ""} maxLength={key === "name" ? 200 : 2000} disabled={saving}
                  onChange={(event) => editStep(key, event.target.value)} />
              </label>)}
              {saveError && <p role="alert">{saveError}</p>}
              <button type="button" disabled={saving || !step.name.trim()} onClick={saveStep}>{saving ? "保存中…" : "保存为新版本"}</button>
            </div>}
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
