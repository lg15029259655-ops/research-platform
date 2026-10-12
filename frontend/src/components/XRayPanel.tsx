"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import EvidenceDrawer from "@/components/EvidenceDrawer";

const XRayFlow = dynamic(() => import("@/components/XRayFlow"), { ssr: false });
type Unit = { id: string; heading: string; kind: string; page_start: number | null };
type XRay = { question: string; domain: string; study_type: string; limitations: string[];
  stages: { key: string; label: string; summary: string; unit_ids: string[] }[] };

export default function XRayPanel({ xray, units, pending, onJump }: {
  xray: XRay | null; units: Unit[]; pending: boolean; onJump: (unitId: string) => void;
}) {
  const [selection, setSelection] = useState<{ stage: number; unitId?: string } | null>(null);
  const stage = selection ? xray?.stages[selection.stage] : null;
  const unit = selection?.unitId ? units.find((item) => item.id === selection.unitId) : null;
  return <div className="visualBoard visualStage"><div className="visualLead"><span>RESEARCH STORYLINE</span><h2>Paper X-Ray</h2><p>主线呈现论文的研究逻辑；下方证据节点可回到 PDF 原页。</p></div>
    {pending && <p className="stepLoading">正在读取论文单元 → 组织研究主线 → 关联原文证据</p>}
    {xray && <><div className="xrayQuestion"><small>核心研究问题 · {xray.domain} / {xray.study_type}</small><strong>{xray.question}</strong></div>
      <XRayFlow stages={xray.stages} units={units} onSelect={(index, unitId) => setSelection({ stage: index, unitId })} />
      <div className="miniNotice">分析基于 PDF 提取文字，节点顺序为 AI 整理的研究逻辑，需对照原文；证据局限：{xray.limitations.join("；") || "请核对原文。"}</div></>}
    {stage && <EvidenceDrawer title={unit?.heading || stage.label} eyebrow={unit ? "原文证据" : "研究主线"} onClose={() => setSelection(null)}
      action={unit ? { label: `查看原文 · PDF ${unit.page_start || "?"} 页 ↗`, onClick: () => onJump(unit.id) } : undefined}>
      <p>{stage.summary}</p><dl><dt>来源论文</dt><dd>当前 PDF</dd><dt>Section / Figure</dt><dd>{unit?.heading || stage.unit_ids.map((id) => units.find((item) => item.id === id)?.heading).filter(Boolean).join("、") || "未定位到具体原文位置"}</dd><dt>PDF 页码</dt><dd>{unit?.page_start || "未定位到具体原文位置"}</dd></dl>
      {!unit && stage.unit_ids.map((id) => { const ref = units.find((item) => item.id === id); return ref && <button key={id} className="drawerTextLink" onClick={() => onJump(ref.id)}>{ref.heading} · PDF {ref.page_start || "?"} 页 ↗</button>; })}
    </EvidenceDrawer>}
  </div>;
}
