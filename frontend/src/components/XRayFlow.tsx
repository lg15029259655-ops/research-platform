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
        style: { width: 205, minHeight: 76, borderRadius: 12, border: "1px solid #aed1bd",
          background: "#fff", padding: 12, color: "#1d5140", boxShadow: "0 6px 19px #214d3112" } });
      if (i) edges.push({ id: `main-${i}`, source: `stage-${i - 1}`, target: `stage-${i}`,
        type: "smoothstep", style: { stroke: "#5e9d80", strokeWidth: 2 } });
      stage.unit_ids.slice(0, 3).forEach((id, branch) => {
        const unit = units.find((item) => item.id === id);
        if (!unit) return;
        const nodeId = `unit-${i}-${id}`;
        nodes.push({ id: nodeId, position: { x: 59 + i * 265, y: 235 + branch * 82 },
          data: { label: `${unit.kind === "FIGURE" || unit.kind === "TABLE" ? "▣ " : "§ "}${unit.heading} · PDF ${unit.page_start || "?"}` },
          style: { width: 185, borderRadius: 9, border: "1px solid #d7e6d9", background: "#f8fbf8",
            padding: 9, color: "#4c7863", fontSize: 11 } });
        edges.push({ id: `branch-${nodeId}`, source: `stage-${i}`, target: nodeId,
          type: "smoothstep", style: { stroke: "#bbd3be", strokeDasharray: "4 4" } });
      });
    });
    return { nodes, edges };
  }, [stages, units]);
  return <div className="xrayFlow"><ReactFlow nodes={nodes} edges={edges} onNodeClick={(_, node) => {
    const parts = node.id.split("-");
    onSelect(Number(parts[1]), parts[0] === "unit" ? parts.slice(2).join("-") : undefined);
  }} nodesDraggable={false} fitView fitViewOptions={{ padding: 0.16 }} proOptions={{ hideAttribution: true }}>
    <Background color="#e6eee6" gap={22} /><Controls showInteractive={false} />
  </ReactFlow></div>;
}
