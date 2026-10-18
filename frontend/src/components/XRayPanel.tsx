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
      {/* D12：@xyflow 节点的 Enter/Space 只切换画布选中态，不会触发 onNodeClick，键盘无法打开抽屉。
          这里给出与画布同源的按钮索引作为等效路径（同 .planetariumIndex 模式），同时让读屏能获取画布内容。 */}
      <div className="planetariumIndex"><div className="planetariumIndexHead"><strong>研究阶段与证据索引</strong><span>键盘可用的等效入口；点击阶段或证据节点打开详情</span></div><section className="planetariumTier"><div className="planetariumTierLabel"><strong>研究主线</strong><span>{xray.stages.length} 个阶段</span></div><div className="planetariumPapers">{xray.stages.map((item, index) => <button key={item.key} onClick={() => setSelection({ stage: index })} title={item.summary}><strong>{String(index + 1).padStart(2, "0")} · {item.label}</strong><small>查看阶段说明 ↗</small></button>)}{xray.stages.flatMap((item, index) => item.unit_ids.map((id) => { const ref = units.find((unit) => unit.id === id); return ref ? <button key={`${item.key}-${id}`} onClick={() => setSelection({ stage: index, unitId: ref.id })} title={ref.heading}><strong>{(ref.kind === "FIGURE" || ref.kind === "TABLE" ? "▣ " : "§ ") + ref.heading}</strong><small>PDF {ref.page_start || "?"} 页 ↗</small></button> : null; }))}</div></section></div>
      <div className="miniNotice">分析基于 PDF 提取文字，节点顺序为 AI 整理的研究逻辑，需对照原文；证据局限：{xray.limitations.join("；") || "请核对原文。"}</div></>}
    {stage && <EvidenceDrawer title={unit?.heading || stage.label} eyebrow={unit ? "原文证据" : "研究主线"} onClose={() => setSelection(null)}
      action={unit ? { label: `查看原文 · PDF ${unit.page_start || "?"} 页 ↗`, onClick: () => onJump(unit.id) } : undefined}>
      <p>{stage.summary}</p><dl><dt>来源论文</dt><dd>当前 PDF</dd><dt>Section / Figure</dt><dd>{unit?.heading || stage.unit_ids.map((id) => units.find((item) => item.id === id)?.heading).filter(Boolean).join("、") || "未定位到具体原文位置"}</dd><dt>PDF 页码</dt><dd>{unit?.page_start || "未定位到具体原文位置"}</dd></dl>
      {!unit && stage.unit_ids.map((id) => { const ref = units.find((item) => item.id === id); return ref && <button key={id} className="drawerTextLink" onClick={() => onJump(ref.id)}>{ref.heading} · PDF {ref.page_start || "?"} 页 ↗</button>; })}
    </EvidenceDrawer>}
  </div>;
}
