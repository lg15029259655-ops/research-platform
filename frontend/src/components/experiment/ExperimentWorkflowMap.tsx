"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import ExperimentIcon, { workflowArtwork } from "@/components/experiment/ExperimentIcon";
import { categoryById, detectCategory, iconUrl, specificMethodCategory } from "@/lib/experiment-categories";
import "./experiment-workflow.css";

/**
 * 实验流程导图（纯 SVG 树，左 → 右）。
 *
 * 设计约束来自需求：
 * 1) 图标空位是重点：阶段（48px）与具体实验（28px）都渲染 ExperimentIcon，
 *    图片没放进 public/icons/experiments/ 时组件自己显示虚线占位框；
 * 2) 长标签必须折行，不允许省略号截断——布局高度由折行结果决定；
 * 3) 折叠/缩放/平移/适配/全屏/导出 PNG+SVG 都要有，样式全部走 .ew-* 命名空间。
 *
 * 实现取舍：屏幕渲染用 <foreignObject> 承载 HTML 内容，这样图标可以直接复用
 * ExperimentIcon（含 onError 回退）；导出时不能依赖 foreignObject（浏览器不保证
 * 能画进 canvas），所以按同一份布局数据重新拼一份"纯 SVG"，图标能 fetch 到就内联
 * 成 dataURL，取不到就画同样的虚线占位框。
 */

export type WorkflowChild = {
  id: string;
  title: string;
  category?: string | null;
  detail?: string | null;
  children?: WorkflowChild[];
};

export type WorkflowStage = {
  id: string;
  title: string;
  category?: string | null;
  detail?: string | null;
  children?: WorkflowChild[];
};

export type ExperimentWorkflow = {
  goal: string;
  constraints?: string | null;
  generated_by?: "ai" | "template" | string;
  stages: WorkflowStage[];
};

type Props = {
  workflow: ExperimentWorkflow | null;
  pending?: boolean;
  /** template 兜底时的"重试生成"入口。 */
  onRetry?: () => void;
};

/* ------------------------------------------------------------------ */
/* 文本度量与折行                                                       */
/* ------------------------------------------------------------------ */

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** 粗略像素宽度：CJK ≈ 1em，拉丁 ≈ 0.56em（略偏大，宁可少放字也不要溢出）。 */
function measureLine(text: string, size: number): number {
  let width = 0;
  for (const ch of text) width += CJK.test(ch) ? size : size * 0.58;
  return width;
}

/**
 * 按像素宽度折行。中文按字断，英文尽量在空格处断；**不做省略号截断**，
 * 需要几行就给几行，节点高度随之增加。
 */
function wrapText(text: string, maxWidth: number, size: number): string[] {
  const content = (text || "").replace(/\s+/g, " ").trim();
  if (!content) return [];
  // 字宽只是估算：留 5% 安全边距，避免某些字体/粗体下最后一两个字被节点 overflow 裁掉。
  const limit = Math.max(24, Math.floor(maxWidth * 0.95));
  const lines: string[] = [];
  let line = "";
  let width = 0;
  let lastSpace = -1;
  const push = (value: string) => {
    const trimmed = value.trimEnd();
    if (trimmed) lines.push(trimmed);
  };
  for (const ch of content) {
    const charWidth = CJK.test(ch) ? size : size * 0.58;
    if (line.length > 0 && width + charWidth > limit) {
      if (lastSpace > 0 && !CJK.test(ch)) {
        const head = line.slice(0, lastSpace);
        const tail = line.slice(lastSpace).trimStart();
        push(head);
        line = tail;
        width = measureLine(tail, size);
      } else {
        push(line);
        line = "";
        width = 0;
      }
      lastSpace = -1;
    }
    line += ch;
    width += charWidth;
    if (ch === " ") lastSpace = line.length;
  }
  push(line);
  return lines.length ? lines : [];
}

/* ------------------------------------------------------------------ */
/* 布局常量与类型                                                       */
/* ------------------------------------------------------------------ */

const ROOT = { width: 262, pad: 14, labelSize: 10, titleSize: 14.5, lineHeight: 21 };
const STAGE = { width: 258, pad: 12, icon: 48, gap: 10, titleSize: 13.5, titleLineHeight: 19, detailSize: 12, detailLineHeight: 16 };
const CHILD = { width: 238, pad: 10, icon: 28, gap: 9, titleSize: 12.5, titleLineHeight: 17, detailSize: 11.5, detailLineHeight: 15 };
const LEVEL_GAP = 72;
const SIBLING_GAP = 16;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

type LaidNode = {
  id: string;
  kind: "root" | "stage" | "child";
  x: number;
  y: number;
  width: number;
  height: number;
  category: string | null;
  titleLines: string[];
  detailLines: string[];
  /** 仅 stage 有：折叠时隐藏的子实验数量。 */
  hiddenCount: number;
  collapsed: boolean;
  stageId?: string;
};

type LaidEdge = { id: string; path: string };

type Layout = { nodes: LaidNode[]; edges: LaidEdge[]; width: number; height: number };

function resolveCategory(raw: string | null | undefined, title: string, detail: string | null | undefined): string | null {
  const specific = specificMethodCategory(title);
  if (specific) return specific;
  if (raw && categoryById(raw)) return raw;
  // 后端应给出合法 id；万一缺失/拼错，用同一套关键词规则兜底，避免整个节点没图标位。
  return detectCategory(`${title} ${detail || ""}`);
}

function stageMetrics(stage: WorkflowStage, collapsed: boolean) {
  // 右上角折叠按钮占 22px + 6px 间隙，标题宽度必须扣掉，否则会压到按钮下面。
  const textWidth = STAGE.width - STAGE.pad * 2 - STAGE.icon - STAGE.gap - 28;
  const titleLines = wrapText(stage.title || "未命名阶段", textWidth, STAGE.titleSize);
  const detailLines = stage.detail ? wrapText(stage.detail, STAGE.width - STAGE.pad * 2, STAGE.detailSize) : [];
  const headerHeight = Math.max(STAGE.icon, titleLines.length * STAGE.titleLineHeight + 15);
  const height =
    STAGE.pad * 2 +
    headerHeight +
    (detailLines.length ? 8 + detailLines.length * STAGE.detailLineHeight : 0) +
    (collapsed && (stage.children?.length || 0) > 0 ? 20 : 0);
  return { titleLines, detailLines, height };
}

function childMetrics(child: WorkflowChild) {
  const textWidth = CHILD.width - CHILD.pad * 2 - CHILD.icon - CHILD.gap;
  const titleLines = wrapText(child.title || "未命名实验", textWidth, CHILD.titleSize);
  const detailLines = child.detail ? wrapText(child.detail, CHILD.width - CHILD.pad * 2, CHILD.detailSize) : [];
  const headerHeight = Math.max(CHILD.icon, titleLines.length * CHILD.titleLineHeight);
  const height = CHILD.pad * 2 + headerHeight + (detailLines.length ? 6 + detailLines.length * CHILD.detailLineHeight : 0);
  return { titleLines, detailLines, height };
}

function buildLayout(workflow: ExperimentWorkflow, collapsed: Set<string>): Layout {
  const goalLines = wrapText(workflow.goal || "研究目标", ROOT.width - ROOT.pad * 2, ROOT.titleSize);
  const constraintLines = workflow.constraints
    ? wrapText(workflow.constraints, ROOT.width - ROOT.pad * 2, 11)
    : [];
  // 约束条件也要算进根节点高度，否则多行约束会盖住目标文字。
  const rootHeight =
    ROOT.pad * 2 +
    15 +
    Math.max(1, goalLines.length) * ROOT.lineHeight +
    (constraintLines.length ? 6 + constraintLines.length * 16 : 0);

  const stages = (workflow.stages || []).slice(0, 6);
  const stageX = ROOT.width + LEVEL_GAP;
  const childX = stageX + STAGE.width + LEVEL_GAP;

  const nodes: LaidNode[] = [];
  const edges: LaidEdge[] = [];
  const rootCenterX = ROOT.width;

  let cursor = 0;
  const childNodes: LaidNode[] = [];

  for (const stage of stages) {
    const isCollapsed = collapsed.has(stage.id);
    const metrics = stageMetrics(stage, isCollapsed);
    const kids = isCollapsed ? [] : (stage.children || []).slice(0, 5);
    const kidMetrics = kids.map((child) => ({ child, ...childMetrics(child) }));
    const kidsHeight = kidMetrics.reduce((sum, item) => sum + item.height, 0) + Math.max(0, kidMetrics.length - 1) * SIBLING_GAP;
    const subtreeHeight = Math.max(metrics.height, kidsHeight);

    const stageY = cursor + (subtreeHeight - metrics.height) / 2;
    const category = resolveCategory(stage.category, stage.title, stage.detail);
    const node: LaidNode = {
      id: stage.id,
      kind: "stage",
      x: stageX,
      y: stageY,
      width: STAGE.width,
      height: metrics.height,
      category,
      titleLines: metrics.titleLines,
      detailLines: metrics.detailLines,
      hiddenCount: isCollapsed ? (stage.children?.length || 0) : 0,
      collapsed: isCollapsed,
      stageId: stage.id,
    };
    nodes.push(node);

    if (kidMetrics.length) {
      let childY = cursor + (subtreeHeight - kidsHeight) / 2;
      for (const item of kidMetrics) {
        childNodes.push({
          id: item.child.id || `${stage.id}-${childY}`,
          kind: "child",
          x: childX,
          y: childY,
          width: CHILD.width,
          height: item.height,
          category: resolveCategory(item.child.category, item.child.title, item.child.detail),
          titleLines: item.titleLines,
          detailLines: item.detailLines,
          hiddenCount: 0,
          collapsed: false,
          stageId: stage.id,
        });
        childY += item.height + SIBLING_GAP;
      }
    }

    edges.push({
      id: `e-${stage.id}`,
      path: bezier(rootCenterX, rootHeight / 2, stageX, stageY + metrics.height / 2),
    });

    cursor += subtreeHeight + SIBLING_GAP;
  }

  const stagesBottom = Math.max(0, cursor - SIBLING_GAP);
  const rootY = stagesBottom / 2 - rootHeight / 2;
  nodes.push({
    id: "root",
    kind: "root",
    x: 0,
    y: rootY,
    width: ROOT.width,
    height: rootHeight,
    category: null,
    titleLines: goalLines.length ? goalLines : ["研究目标"],
    detailLines: constraintLines,
    hiddenCount: 0,
    collapsed: false,
  });

  for (const child of childNodes) {
    const parent = nodes.find((node) => node.id === child.stageId);
    if (!parent) continue;
    edges.push({
      id: `e-${parent.id}-${child.id}`,
      path: bezier(
        parent.x + parent.width,
        parent.y + parent.height / 2,
        child.x,
        child.y + child.height / 2,
      ),
    });
    nodes.push(child);
  }

  const width = Math.max(ROOT.width, ...nodes.map((node) => node.x + node.width));
  const height = Math.max(...nodes.map((node) => node.y + node.height), 1);
  return { nodes, edges, width, height };
}

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(24, (x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/* ------------------------------------------------------------------ */
/* 导出（纯 SVG）                                                       */
/* ------------------------------------------------------------------ */

const COLORS = {
  ink: "#23282F",
  primary: "#0A5AC2",
  soft: "#5B6577",
  line: "#D7E0EE",
  primaryLine: "#BEDAF8",
  weak: "#EAF4FF",
  surface: "#FFFFFF",
  surface2: "#F5F8FC",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char] as string));
}

async function iconDataUrl(category: string): Promise<string | null> {
  try {
    const response = await fetch(iconUrl(category));
    if (response.ok) {
      const blob = await response.blob();
      if (blob.type.startsWith("image/")) return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    }
    const artwork = workflowArtwork[category];
    if (!artwork) return null;
    const image = new Image();
    image.src = `/research-elements/${artwork[0]}`;
    await image.decode();
    const columns = artwork[0] === "workflow-extra-v1.png" ? 3 : 2;
    const [horizontal, vertical] = artwork[1].split(" ");
    const x = horizontal === "100%" ? columns - 1 : horizontal === "50%" ? 1 : 0;
    const y = vertical === "100%" ? 1 : 0;
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, x * image.naturalWidth / columns, y * image.naturalHeight / 2, image.naturalWidth / columns, image.naturalHeight / 2, 0, 0, 512, 512);
    return canvas.toDataURL("image/png");
  } catch { return null; }
}

async function buildSvgString(layout: Layout): Promise<string> {
  const pad = 28;
  const width = layout.width + pad * 2;
  const height = layout.height + pad * 2;
  const categories = Array.from(new Set(layout.nodes.map((node) => node.category).filter((item): item is string => !!item)));
  const icons = new Map<string, string | null>();
  await Promise.all(categories.map(async (id) => { icons.set(id, await iconDataUrl(id)); }));

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif">`,
    `<rect width="100%" height="100%" fill="${COLORS.surface}"/>`,
    `<g transform="translate(${pad} ${pad})">`,
  );

  for (const edge of layout.edges) {
    parts.push(`<path d="${edge.path}" fill="none" stroke="${COLORS.primaryLine}" stroke-width="1.5"/>`);
  }

  for (const node of layout.nodes) {
    const isRoot = node.kind === "root";
    const isStage = node.kind === "stage";
    const fill = isRoot ? COLORS.weak : isStage ? COLORS.surface : COLORS.surface2;
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="12" fill="${fill}" stroke="${COLORS.primaryLine}" stroke-width="1"/>`);

    if (isRoot) {
      parts.push(`<text x="${node.x + ROOT.pad}" y="${node.y + ROOT.pad + 9}" font-size="10" fill="${COLORS.soft}" letter-spacing="1">研究目标</text>`);
      node.titleLines.forEach((line, index) => {
        parts.push(`<text x="${node.x + ROOT.pad}" y="${node.y + ROOT.pad + 34 + index * ROOT.lineHeight}" font-size="${ROOT.titleSize}" font-weight="700" fill="${COLORS.ink}">${escapeXml(line)}</text>`);
      });
      const detailTop = node.y + node.height - ROOT.pad - node.detailLines.length * 16;
      node.detailLines.forEach((line, index) => {
        parts.push(`<text x="${node.x + ROOT.pad}" y="${detailTop + index * 16}" font-size="11" fill="${COLORS.soft}">${escapeXml(line)}</text>`);
      });
      continue;
    }

    const metrics = isStage ? STAGE : CHILD;
    const iconSize = metrics.icon;
    const iconX = node.x + metrics.pad;
    const iconY = node.y + metrics.pad;
    const dataUrl = node.category ? icons.get(node.category) : null;
    if (dataUrl) {
      parts.push(`<image x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" href="${dataUrl}" preserveAspectRatio="xMidYMid meet"/>`);
    } else {
      const meta = categoryById(node.category);
      parts.push(`<rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="${Math.round(iconSize * 0.2)}" fill="${COLORS.weak}" stroke="${COLORS.primaryLine}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      if (meta) {
        parts.push(`<text x="${iconX + iconSize / 2}" y="${iconY + iconSize / 2 + 4}" font-size="${Math.max(9, Math.round(iconSize / 4.6))}" fill="${COLORS.primary}" text-anchor="middle">${escapeXml(meta.short)}</text>`);
      }
    }

    const textX = iconX + iconSize + metrics.gap;
    node.titleLines.forEach((line, index) => {
      parts.push(`<text x="${textX}" y="${iconY + 12 + index * metrics.titleLineHeight}" font-size="${metrics.titleSize}" font-weight="600" fill="${COLORS.primary}">${escapeXml(line)}</text>`);
    });
    const detailX = node.x + metrics.pad;
    const detailY = node.y + metrics.pad + Math.max(iconSize, node.titleLines.length * metrics.titleLineHeight + (isStage ? 15 : 0)) + (isStage ? 8 : 6);
    node.detailLines.forEach((line, index) => {
      parts.push(`<text x="${detailX}" y="${detailY + index * metrics.detailLineHeight}" font-size="${metrics.detailSize}" fill="${COLORS.soft}">${escapeXml(line)}</text>`);
    });

    if (node.collapsed && node.hiddenCount > 0) {
      parts.push(`<text x="${node.x + node.width - metrics.pad}" y="${node.y + node.height - 10}" font-size="10" fill="${COLORS.soft}" text-anchor="end">＋${node.hiddenCount} 项已折叠</text>`);
    }
  }

  parts.push("</g></svg>");
  return parts.join("");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 浏览器需要一点时间开始下载后再回收 URL。
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ------------------------------------------------------------------ */
/* 组件                                                                */
/* ------------------------------------------------------------------ */

export default function ExperimentWorkflowMap({ workflow, pending = false, onRetry }: Props) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [fullscreen, setFullscreen] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [exporting, setExporting] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const draggedRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const fittedKey = useRef<string>("");

  const layout = useMemo(() => (workflow ? buildLayout(workflow, collapsed) : null), [workflow, collapsed]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitView = useCallback((next = layout) => {
    if (!next || !viewport.width || !viewport.height) return;
    const padding = 36;
    const scale = Math.min(
      (viewport.width - padding * 2) / Math.max(1, next.width),
      (viewport.height - padding * 2) / Math.max(1, next.height),
      1.1,
    );
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
    setView({
      scale: clamped,
      x: (viewport.width - next.width * clamped) / 2,
      y: (viewport.height - next.height * clamped) / 2,
    });
  }, [layout, viewport.width, viewport.height]);

  // 数据变化后自动适配；同一份数据只在首次布局时 fit，避免折叠/展开后视角乱跳。
  // 必须等视口尺寸就绪再记录 key：首帧 viewport=0 时若写死 key，之后永远不会再 fit。
  useEffect(() => {
    if (!workflow || !layout || !viewport.width || !viewport.height) return;
    const key = `${workflow.goal.slice(0, 40)}:${workflow.stages.length}`;
    if (fittedKey.current === key) return;
    fittedKey.current = key;
    fitView(layout);
  }, [workflow, layout, viewport.width, viewport.height, fitView]);

  // 滚轮缩放：React 的 onWheel 是 passive，不能 preventDefault，所以用原生监听。
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((previous) => {
        const factor = Math.exp(-event.deltaY * 0.0016);
        const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, previous.scale * factor));
        const ratio = scale / previous.scale;
        return { scale, x: px - (px - previous.x) * ratio, y: py - (py - previous.y) * ratio };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleStage = useCallback((stageId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  }, []);

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set((workflow?.stages || []).map((stage) => stage.id)));

  const toggleFullscreen = async () => {
    const element = shellRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      // 某些浏览器/嵌入式环境禁止全屏：忽略即可，图表仍可缩放平移。
    }
  };

  async function runExport(kind: "svg" | "png") {
    if (!layout || exporting) return;
    setExporting(true);
    try {
      const svg = await buildSvgString(layout);
      const filename = `experiment-workflow-${new Date().toISOString().slice(0, 10)}`;
      if (kind === "svg") {
        downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${filename}.svg`);
        return;
      }
      // PNG：先把 SVG 画到 canvas（2x 便于插入 PPT），再导出 PNG。
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      try {
        const image = new Image();
        image.decoding = "sync";
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("SVG 渲染失败"));
          image.src = url;
        });
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale) || (layout.width + 56) * scale;
        canvas.height = Math.round(image.height * scale) || (layout.height + 56) * scale;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas 不可用");
        context.fillStyle = COLORS.surface;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (blob) downloadBlob(blob, `${filename}.png`);
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  }

  /* ---------- 拖拽平移 ---------- */
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button")) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    draggedRef.current = { startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = draggedRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.moved) setView((previous) => ({ ...previous, x: drag.originX + dx, y: drag.originY + dy }));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggedRef.current) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 已释放 */ }
    }
    draggedRef.current = null;
  };

  const stages = workflow?.stages || [];
  const isTemplate = workflow?.generated_by === "template";

  if (!workflow || stages.length === 0) {
    return (
      <div className="ew-empty" role="status">
        <span className="ew-empty-mark" aria-hidden="true">□→□→□</span>
        <strong>{pending ? "正在生成实验流程…" : "还没有实验流程导图"}</strong>
        <p>
          {pending
            ? "正在根据研究想法拆解阶段与具体实验，图标位会随之出现。"
            : "生成后会在这里显示实验阶段、每个阶段的具体实验，以及对应的图标位。图标图片缺失时会显示虚线占位框。"}
        </p>
      </div>
    );
  }

  return (
    <div ref={shellRef} className={`ew-shell${fullscreen ? " is-fullscreen" : ""}`} aria-label="实验流程导图">
      <div className="ew-toolbar">
        <div className="ew-toolbar-group">
          <button type="button" aria-label="缩小" onClick={() => setView((previous) => ({ ...previous, scale: Math.max(MIN_ZOOM, previous.scale / 1.15) }))}>−</button>
          <span className="ew-zoom" aria-live="polite">{Math.round(view.scale * 100)}%</span>
          <button type="button" aria-label="放大" onClick={() => setView((previous) => ({ ...previous, scale: Math.min(MAX_ZOOM, previous.scale * 1.15) }))}>＋</button>
          <button type="button" onClick={() => fitView()}>适配画布</button>
        </div>
        <div className="ew-toolbar-group">
          <button type="button" onClick={expandAll}>全部展开</button>
          <button type="button" onClick={collapseAll}>全部折叠</button>
          <button type="button" onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen ? "退出全屏" : "全屏"}</button>
          <button type="button" onClick={() => void runExport("svg")} disabled={exporting}>导出 SVG</button>
          <button type="button" onClick={() => void runExport("png")} disabled={exporting}>{exporting ? "导出中…" : "导出 PNG"}</button>
        </div>
      </div>

      {isTemplate && (
        <div className="ew-notice" role="note">
          <span>当前为通用模板，可重试生成更贴合你研究想法的方案。</span>
          {onRetry && <button type="button" onClick={onRetry}>重新生成</button>}
        </div>
      )}

      <div
        ref={viewportRef}
        className="ew-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="group"
        aria-label="可缩放与拖拽的实验流程画布"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Escape" && fullscreen) void document.exitFullscreen().catch(() => undefined);
        }}
      >
        <svg className="ew-svg" width="100%" height="100%" role="img" aria-label={`实验流程：${workflow.goal}`}>
          <g
            transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}
            style={reduceMotion ? undefined : { transition: "transform 160ms ease-out" }}
          >
            {layout?.edges.map((edge) => (
              <path key={edge.id} d={edge.path} className="ew-edge" />
            ))}
            {layout?.nodes.map((node) => (
              <foreignObject key={node.id} x={node.x} y={node.y} width={node.width} height={node.height} className="ew-foreign">
                {node.kind === "root" ? (
                  <div className="ew-node ew-node-root">
                    <span className="ew-kicker">研究目标</span>
                    <div className="ew-root-title">
                      {node.titleLines.map((line, index) => <div key={index} className="ew-line">{line}</div>)}
                    </div>
                    {node.detailLines.length > 0 && (
                      <div className="ew-root-detail">
                        {node.detailLines.map((line, index) => <div key={index} className="ew-line">{line}</div>)}
                      </div>
                    )}
                  </div>
                ) : node.kind === "stage" ? (
                  <div className={`ew-node ew-node-stage${node.collapsed ? " is-collapsed" : ""}`}>
                    <div className="ew-stage-head">
                      <span className="ew-icon-slot">
                        <ExperimentIcon category={node.category} size={48} />
                      </span>
                      <div className="ew-stage-text">
                        <div className="ew-stage-title">
                          {node.titleLines.map((line, index) => <div key={index} className="ew-line">{line}</div>)}
                        </div>
                        {node.category && <span className="ew-stage-cat">{categoryById(node.category)?.short || ""}</span>}
                      </div>
                      <button
                        type="button"
                        className="ew-toggle"
                        aria-expanded={!node.collapsed}
                        aria-label={node.collapsed ? `展开阶段：${node.titleLines.join("")}` : `折叠阶段：${node.titleLines.join("")}`}
                        onClick={() => node.stageId && toggleStage(node.stageId)}
                      >
                        {node.collapsed ? "＋" : "−"}
                      </button>
                    </div>
                    {node.detailLines.length > 0 && (
                      <div className="ew-stage-detail">
                        {node.detailLines.map((line, index) => <div key={index} className="ew-line">{line}</div>)}
                      </div>
                    )}
                    {node.collapsed && node.hiddenCount > 0 && (
                      <span className="ew-folder">＋{node.hiddenCount} 项已折叠</span>
                    )}
                  </div>
                ) : (
                  <div className="ew-node ew-node-child">
                    <div className="ew-child-head">
                      <span className="ew-icon-slot ew-icon-slot-sm">
                        <ExperimentIcon category={node.category} size={28} />
                      </span>
                      <div className="ew-child-text">
                        {node.titleLines.map((line, index) => <div key={index} className="ew-line">{line}</div>)}
                      </div>
                    </div>
                    {node.detailLines.length > 0 && (
                      <div className="ew-child-detail">
                        {node.detailLines.map((line, index) => <div key={index} className="ew-line">{line}</div>)}
                      </div>
                    )}
                  </div>
                )}
              </foreignObject>
            ))}
          </g>
        </svg>
      </div>

      {/* 画布里的折叠按钮在 foreignObject 内，键盘用户还需要一份等效入口（项目既有模式）。 */}
      <div className="ew-index">
        <span className="ew-index-title">阶段索引</span>
        <div className="ew-index-list">
          {stages.map((stage, index) => (
            <button
              key={stage.id}
              type="button"
              aria-expanded={!collapsed.has(stage.id)}
              onClick={() => toggleStage(stage.id)}
            >
              <b>{String(index + 1).padStart(2, "0")}</b>
              <span>{stage.title}</span>
              <small>{collapsed.has(stage.id) ? `＋${(stage.children || []).length} 项` : `${(stage.children || []).length} 项`}</small>
            </button>
          ))}
        </div>
        <p className="ew-hint">图标位对应 <code>public/icons/experiments/&lt;分类&gt;.png</code>，放入图片后刷新即可显示；缺失时显示虚线占位框。</p>
      </div>
    </div>
  );
}
