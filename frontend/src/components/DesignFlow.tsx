"use client";

import { useEffect, useRef, useState } from "react";
import { ReactFlow, Background, MiniMap, useEdgesState, useNodesState, type Edge, type Node, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type Design = { nodes: { id: string; label: string; type: string; detail: string }[];
  edges: { source: string; target: string; label: string }[] };

export default function DesignFlow({ design, onSelectNode }: { design: Design; onSelectNode?: (id: string) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    const count = Math.min(design.nodes.length, 16);
    setNodes(design.nodes.slice(0, count).map((item, index) => ({
      id: item.id, position: { x: 55 + (index % 3) * 285, y: 55 + Math.floor(index / 3) * 142 },
      data: { label: <div className="designNode"><small>{item.type || "研究步骤"} · {String(index + 1).padStart(2, "0")}</small><strong>{item.label}</strong><span>点击查看完整设计 ↗</span></div> },
      // 内联 style 压得过 CSS，所以这里的颜色只能直接取 token 变量。
      // 网格点与缩略图节点走 @xyflow 的 --xy-* 降级链，在 studio.css 的 .flowWrap 上按 token 赋值。
      style: { width: 230, background: "var(--c-surface)", border: "1px solid var(--c-primary-line)",
        borderRadius: 12, padding: 0, color: "var(--c-ink-3)", boxShadow: "var(--sh-2)" },
    })));
    const visible = new Set(design.nodes.slice(0, count).map((item) => item.id));
    setEdges(design.edges.filter((item) => visible.has(item.source) && visible.has(item.target)).map((item, index) => ({
      id: `edge-${index}`, source: item.source, target: item.target,
      type: "smoothstep", animated: false, style: { stroke: "var(--c-flow-edge)", strokeWidth: 1.5 },
    })));
  }, [design, setNodes, setEdges]);
  return <div className="flowWrap"><div className="flowToolbar"><span>方案结构 · {design.nodes.length} 个节点</span><div><button aria-label="放大方案" onClick={() => flowRef.current?.zoomIn({duration: 120})}>＋</button><span>{zoom}%</span><button aria-label="缩小方案" onClick={() => flowRef.current?.zoomOut({duration: 120})}>－</button><button onClick={() => flowRef.current?.fitView({padding: 0.16, duration: 150, maxZoom: 1.1})}>适配画布</button></div></div><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
    onNodeClick={(_, node) => onSelectNode?.(node.id)}
    onInit={(instance) => { flowRef.current = instance; setZoom(Math.round(instance.getZoom() * 100)); }}
    onMoveEnd={(_, viewport) => setZoom(Math.round(viewport.zoom * 100))}
    fitView fitViewOptions={{ padding: 0.16, maxZoom: 1.1 }} minZoom={0.25} maxZoom={2.5} nodesDraggable zoomOnScroll panOnDrag proOptions={{ hideAttribution: true }}>
    <Background gap={22} /><MiniMap pannable zoomable nodeColor="var(--c-flow-mini)" />
  </ReactFlow></div>;
}
