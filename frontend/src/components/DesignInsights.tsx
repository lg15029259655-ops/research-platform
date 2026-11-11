"use client";

import { useEffect, useRef, useState } from "react";
import { submitJob, watchJob, type JobKind } from "@/lib/jobs";
import "./design-insights.css";

type Node = { id: string; label: string; type: string; detail: string };
type Review = { artifact_id: string; issues: { title: string; reason: string; suggestion: string; node_id: string }[]; limitations: string[] };
type Outcomes = { artifact_id: string; node_id: string; branches: { scenario: string; interpretation: string; next_step: string }[]; limitations: string[] };

export default function DesignInsights({ artifactId, nodes, onSelectNode }: { artifactId: string; nodes: Node[]; onSelectNode: (id: string) => void }) {
  const [tab, setTab] = useState<"review" | "outcomes">("review");
  const [nodeId, setNodeId] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [outcomes, setOutcomes] = useState<Outcomes | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    active.current?.abort(); active.current = null;
    setBusy(false); setReview(null); setOutcomes(null); setError(""); setNodeId("");
    return () => { active.current?.abort(); active.current = null; };
  }, [artifactId]);

  async function run(kind: "design_review" | "design_outcomes") {
    if (!artifactId || (kind === "design_outcomes" && !nodeId)) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(""); setStage("正在提交任务");
    try {
      const job = await submitJob(kind as JobKind, { artifact_id: artifactId, ...(kind === "design_outcomes" ? { node_id: nodeId } : {}) });
      const result = await watchJob(job.id, { onStage: (_key, label) => setStage(label) }, controller.signal);
      if (controller.signal.aborted) return;
      if (result.status !== "done") throw new Error(result.error?.message || "分析未完成，请重试");
      if (kind === "design_review") setReview(result.result as Review);
      else setOutcomes(result.result as Outcomes);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "分析失败，请重试"); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); setStage(""); } }
  }

  return <section className="design-insights" aria-label="方案推敲">
    <div className="di-heading"><div><span>DESIGN REVIEW</span><h2>把方案推敲清楚</h2><p>围绕当前保存的方案检查缺口，或推演某一步可能出现的结果。</p></div><div className="di-tabs"><button type="button" aria-pressed={tab === "review"} onClick={() => setTab("review")}>方案检查</button><button type="button" aria-pressed={tab === "outcomes"} onClick={() => setTab("outcomes")}>结果推演</button></div></div>
    {error && <p role="alert" className="di-error">{error}</p>}
    {tab === "review" ? <div className="di-content"><div className="di-intro"><strong>检查当前版本</strong><p>围绕研究逻辑、对照、测量和实施条件提示需要核查的问题。结果是辅助建议，不代表专家审查通过。</p><button type="button" disabled={busy} onClick={() => run("design_review")}>{busy ? stage || "分析中…" : review ? "重新检查" : "开始方案检查"}</button></div>{review && <div className="di-results">{review.issues.length ? review.issues.map((issue, i) => <article key={i}><span>待核查 {String(i + 1).padStart(2, "0")}</span><h3>{issue.title}</h3><p>{issue.reason}</p><p><b>可考虑：</b>{issue.suggestion}</p>{issue.node_id && <button type="button" onClick={() => onSelectNode(issue.node_id)}>查看关联步骤 ↗</button>}</article>) : <p>本次未识别到具体问题，不代表方案不存在遗漏，请结合原文与专家意见核查。</p>}{review.limitations.map((item, i) => <p className="di-note" key={i}>{item}</p>)}</div>}</div> : <div className="di-content"><div className="di-intro"><strong>从一个关键步骤开始</strong><p>选择步骤，分别考虑结果支持、不支持或尚不明确时可能的解释与下一步。</p><label htmlFor="insight-node">选择研究步骤</label><select id="insight-node" disabled={busy} value={nodeId} onChange={e => { setNodeId(e.target.value); setOutcomes(null); }}><option value="">请选择</option>{nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select><button type="button" disabled={busy || !nodeId} onClick={() => run("design_outcomes")}>{busy ? stage || "推演中…" : "推演可能结果"}</button><p className="di-note">这是实验前的可能性推演，不是实际实验数据或对结果的保证。</p></div>{outcomes && <div className="di-results">{outcomes.branches.map((branch, i) => <article key={i}><span>可能情况 {String(i + 1).padStart(2, "0")}</span><h3>{branch.scenario}</h3><p><b>如何理解：</b>{branch.interpretation}</p><p><b>下一步：</b>{branch.next_step}</p></article>)}{outcomes.limitations.map((item, i) => <p className="di-note" key={i}>{item}</p>)}</div>}</div>}
  </section>;
}
