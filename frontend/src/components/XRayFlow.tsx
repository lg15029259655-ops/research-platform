"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type Stage = { key: string; label: string; summary: string; unit_ids: string[] };
type Unit = { id: string; heading: string; kind: string; page_start: number | null };

export default function XRayFlow({ stages, units, onSelect }: {
  stages: Stage[]; units: Unit[]; onSelect: (stageIndex: number, unitId?: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    stages.slice(0, 7).forEach((stage, i) => {
      nodes.push({ id: `stage-${i}`, position: { x: 50 + i * 265, y: 90 },
        data: { label: <><small>{String(i + 1).padStart(2, "0")} / 研究主线</small><strong>{stage.label}</strong></> },
        style: { width: 205, minHeight: 76, borderRadius: 12, border: "1px solid var(--c-primary-line)",
          background: "var(--c-surface)", padding: 12, color: "var(--c-primary)", boxShadow: "var(--sh-2)" } });
      if (i) edges.push({ id: `main-${i}`, source: `stage-${i - 1}`, target: `stage-${i}`,
        type: "smoothstep", style: { stroke: "var(--c-primary)", strokeWidth: 2 } });
      stage.unit_ids.slice(0, 3).forEach((id, branch) => {
        const unit = units.find((item) => item.id === id);
        if (!unit) return;
        const nodeId = `unit-${i}-${id}`;
        nodes.push({ id: nodeId, position: { x: 59 + i * 265, y: 235 + branch * 82 },
          data: { label: `${unit.kind === "FIGURE" || unit.kind === "TABLE" ? "▣ " : "§ "}${unit.heading} · PDF ${unit.page_start || "?"}` },
          style: { width: 185, borderRadius: 8, border: "1px solid var(--c-line-strong)", background: "var(--c-surface-2)",
            padding: 9, color: "var(--c-text-soft)", fontSize: 12 } });
        edges.push({ id: `branch-${nodeId}`, source: `stage-${i}`, target: nodeId,
          type: "smoothstep", style: { stroke: "var(--c-flow-edge)", strokeDasharray: "4 4" } });
      });
    });
    return { nodes, edges };
  }, [stages, units]);
  return <div className="xrayFlow"><ReactFlow nodes={nodes} edges={edges} onNodeClick={(_, node) => {
    const parts = node.id.split("-");
    onSelect(Number(parts[1]), parts[0] === "unit" ? parts.slice(2).join("-") : undefined);
  }} nodesDraggable={false} nodesFocusable fitView fitViewOptions={{ padding: 0.16 }} proOptions={{ hideAttribution: true }}>
    {/* 网格点色不写在这里：color prop 会抢先于 --xy-* 降级链，改由 research.css 的 .xrayFlow
        设 --xy-background-pattern-color:var(--c-surface-3)（与 .flowWrap 同一机制）。 */}
    <Background gap={22} /><Controls showInteractive={false} />
  </ReactFlow></div>;
}
