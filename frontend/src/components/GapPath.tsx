"use client";

import { useState } from "react";
import EvidenceDrawer from "@/components/EvidenceDrawer";

type Comparison = { consensus: string[]; controversies: { claim: string; reason: string }[];
  gaps: string[]; questions: string[]; next_steps: string[] };

export default function GapPath({ data, onUseQuestion, handoffPending, handoffError }: {
  data: Comparison; onUseQuestion: (question: string) => void; handoffPending: boolean; handoffError?: string;
}) {
  const [selection, setSelection] = useState<{ label: string; value: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chosenQuestion, setChosenQuestion] = useState(0);
  const steps = [
    ["现有共识", data.consensus],
    ["当前争议", data.controversies.map((item) => item.claim)],
    ["缺失证据", data.controversies.filter((item) => item.reason).map((item) => item.reason)],
    ["研究空白", data.gaps],
    ["潜在研究问题", data.questions],
    ["推荐下一步", data.next_steps],
  ] as const;
  const availableSteps = steps.filter(([, values]) => values.length > 0);
  const missing = steps.filter(([, values]) => values.length === 0).map(([label]) => label);
  return <div className="gapPath"><div className="evidenceMapIntro"><strong>Research Gap Path</strong><span>从现有共识和争议，推导下一步研究问题</span></div>
    {!!missing.length && <div className="gapMissing">本次结果未形成可核查的{missing.join("、")}；下方仅展示已有的研究空白与问题，具体结论仍需核对原文。</div>}
    <div className="gapJourney">{availableSteps.map(([label, values], index) => <div className="gapStep hasContent" key={label}><div className="gapStepAxis"><b>{String(index + 1).padStart(2, "0")}</b><span>{label}</span></div><div className="gapStepItems"><button className="gapLead" onClick={() => setSelection({label, value: values[label === "潜在研究问题" ? Math.min(chosenQuestion, values.length - 1) : 0]})}>{(values[label === "潜在研究问题" ? Math.min(chosenQuestion, values.length - 1) : 0] || "").slice(0, 150)}{(values[label === "潜在研究问题" ? Math.min(chosenQuestion, values.length - 1) : 0] || "").length > 150 ? "…" : ""}</button>{values.length > 1 && <button className="gapMore" onClick={() => setExpanded(expanded === label ? null : label)}>{expanded === label ? "收起" : `另有 ${values.length - 1} 条 · 展开`}</button>}{expanded === label && <div className="gapAlternatives">{values.map((value, i) => <button key={i} onClick={() => { if (label === "潜在研究问题") setChosenQuestion(i); else setSelection({label, value}); setExpanded(null); }}>{label === "潜在研究问题" ? `${i === chosenQuestion ? "●" : "○"} ` : ""}{value}</button>)}</div>}</div></div>)}</div>
    {!!data.questions.length && <div className="gapFooter"><span>已选研究问题可继续转化为可编辑的实验设计。</span><button className="gapUse" disabled={handoffPending} aria-busy={handoffPending} onClick={() => onUseQuestion(data.questions[Math.min(chosenQuestion, data.questions.length - 1)])}>{handoffPending ? "正在带入研究问题…" : "用这个问题设计研究 →"}</button></div>}
    {handoffError && <p className="researchError" role="alert">{handoffError}</p>}
    {selection && <EvidenceDrawer title={selection.label} onClose={() => setSelection(null)}><p>{selection.value}</p><p className="miniNotice">这条路径由论文综合结果整理；具体原文位置请到 Evidence Map 的证据节点核对。若未定位来源，不把它当作已经核验的全文事实。</p></EvidenceDrawer>}
  </div>;
}
