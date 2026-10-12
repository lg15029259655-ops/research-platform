"use client";

import { useState } from "react";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import { API } from "@/lib/api";

type Unit = { id: string; heading: string; kind: string; page_start: number | null;
  caption?: string | null; evidence_snippet?: string | null };
type Message = { role: string; content: string; reading_unit_id: string | null; visual_verified?: boolean };

function short(text: string | null | undefined, limit = 110) {
  if (!text) return "当前原文未定位到可核查的结果文字。";
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? normalized.slice(0, limit) + "…" : normalized;
}

export default function FigureStoryboard({ paperId, units, messages, onJump }: {
  paperId: string; units: Unit[]; messages: Message[]; onJump: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Unit | null>(null);
  const visuals = units.filter((unit) => unit.kind === "FIGURE" || unit.kind === "TABLE");
  const related = selected ? messages.filter((item) => item.role === "assistant" && item.reading_unit_id === selected.id) : [];
  const verified = related.some((item) => item.visual_verified);
  return <div className="visualBoard visualStage"><div className="visualLead"><span>FIGURE STORYLINE</span><h2>Figure Storyboard</h2><p>按论文顺序阅读图表，点击节点查看图注、正文线索及原文页面。</p></div>
    {visuals.length ? <div className="storyTimeline">{visuals.map((unit, index) => {
      const hasVisual = messages.some((item) => item.role === "assistant" && item.reading_unit_id === unit.id && item.visual_verified);
      return <div className="storyItem" key={unit.id}><button className="storyTile" onClick={() => setSelected(unit)}>
        <span>{String(index + 1).padStart(2, "0")} / {unit.heading} · PDF {unit.page_start || "?"}</span>
        {unit.page_start && <img src={`${API}/api/papers/${paperId}/pages/${unit.page_start}/thumbnail`} alt={`${unit.heading} 所在 PDF 第 ${unit.page_start} 页`} loading="lazy" />}
        <strong>{short(unit.caption, 80)}</strong><small>{unit.kind === "FIGURE" ? hasVisual ? "✓ 已完成一次视觉核验" : "图像未核验" : "表格原文待核对"}</small>
      </button>{index < visuals.length - 1 && <span className="storyArrow">→</span>}</div>;
    })}</div> : <div className="miniNotice">未可靠定位到主文 Figure 或 Table。Results 仍可按结果正文精读。</div>}
    {selected && <EvidenceDrawer title={selected.heading} eyebrow="Figure / Table 证据" onClose={() => setSelected(null)}
      action={{ label: `查看原文 · PDF ${selected.page_start || "?"} 页 ↗`, onClick: () => onJump(selected.id) }}>
      <dl><dt>PDF 页码</dt><dd>{selected.page_start || "未定位"}</dd><dt>图注 / 表注</dt><dd>{selected.caption || "未提取到图注或表注"}</dd><dt>Results 正文线索</dt><dd>{selected.evidence_snippet || "未定位到具体原文位置"}</dd><dt>视觉核验</dt><dd>{selected.kind === "FIGURE" ? verified ? "该 Figure 曾成功交给视觉模型分析" : "当前仅能依据正文和图注，图像尚未完成视觉核验" : "表格数据需核对原始 PDF"}</dd></dl>
      {related.length > 0 && <><h4>最近一次讲解</h4><p>{short(related[related.length - 1].content, 900)}</p></>}
    </EvidenceDrawer>}
  </div>;
}
