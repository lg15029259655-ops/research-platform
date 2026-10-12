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
      style: { width: 230, background: "#fff", border: "1px solid #b9d7c7",
        borderRadius: 13, padding: 0, color: "#244b3b", boxShadow: "0 10px 22px #153f2c13" },
    })));
    const visible = new Set(design.nodes.slice(0, count).map((item) => item.id));
    setEdges(design.edges.filter((item) => visible.has(item.source) && visible.has(item.target)).map((item, index) => ({
      id: `edge-${index}`, source: item.source, target: item.target,
      type: "smoothstep", animated: false, style: { stroke: "#9fc6b0", strokeWidth: 1.5 },
    })));
  }, [design, setNodes, setEdges]);
  return <div className="flowWrap"><div className="flowToolbar"><span>方案结构 · {design.nodes.length} 个节点</span><div><button aria-label="放大方案" onClick={() => flowRef.current?.zoomIn({duration: 120})}>＋</button><span>{zoom}%</span><button aria-label="缩小方案" onClick={() => flowRef.current?.zoomOut({duration: 120})}>－</button><button onClick={() => flowRef.current?.fitView({padding: 0.16, duration: 150, maxZoom: 1.1})}>适配画布</button></div></div><ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
    onNodeClick={(_, node) => onSelectNode?.(node.id)}
    onInit={(instance) => { flowRef.current = instance; setZoom(Math.round(instance.getZoom() * 100)); }}
    onMoveEnd={(_, viewport) => setZoom(Math.round(viewport.zoom * 100))}
    fitView fitViewOptions={{ padding: 0.16, maxZoom: 1.1 }} minZoom={0.25} maxZoom={2.5} nodesDraggable zoomOnScroll panOnDrag proOptions={{ hideAttribution: true }}>
    <Background color="#deeadf" gap={22} /><MiniMap pannable zoomable nodeColor="#7ab7a0" />
  </ReactFlow></div>;
}
