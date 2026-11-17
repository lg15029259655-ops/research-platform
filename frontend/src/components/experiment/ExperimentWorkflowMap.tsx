"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
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

const ROOT = { width: 276, pad: 16, labelSize: 11, titleSize: 16.5, lineHeight: 24 };
const STAGE = { width: 268, pad: 14, icon: 50, gap: 10, titleSize: 15.5, titleLineHeight: 21, detailSize: 13.5, detailLineHeight: 18 };
const CHILD = { width: 246, pad: 12, icon: 30, gap: 9, titleSize: 14, titleLineHeight: 19, detailSize: 13, detailLineHeight: 17 };
const LEVEL_GAP = 72;
const SIBLING_GAP = 16;
/** 阶段卡片的强调色：按阶段顺序取色，连线与卡片左边条同色，避免整张图只有一种蓝。 */
const STAGE_ACCENTS = ["#0A5AC2", "#0E7C86", "#7A5AF8", "#B26A00", "#2F80ED", "#5B7089"];
/** 流水线箭头两侧留白（放在阶段卡片之间，避免箭头贴住卡片）。 */
const PIPELINE_GAP = 66;
const MIN_ZOOM = 0.28; // 手机窄屏需要更小缩放才能一屏看全（桌面通常 >0.5，不受影响）
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
  /** 阶段强调色（一级阶段按顺序分配，子实验继承所在阶段）。 */
  accent: string;
  /** 阶段序号（1 起）；子实验也记录所属阶段序号用于 “2.1” 这样的编号。 */
  stageIndex: number;
  /** 阶段下的步骤总数（用于“3 步”徽标）。 */
  childCount: number;
  /** 子实验在本阶段内的序号（1 起），阶段节点为空。 */
  stepIndex?: number;
};

type LaidEdge = {
  id: string;
  path: string;
  /** flow = 阶段之间/目标到阶段的流程箭头；branch = 阶段连到子实验的枝线。 */
  kind: "flow" | "branch";
  accent: string;
};

/* 阶段色带：每个阶段背后一条很浅的同色块，把“阶段+它的步骤”在视觉上框成一组。 */
type LaidBand = { id: string; x: number; y: number; width: number; height: number; accent: string };
type Layout = { nodes: LaidNode[]; edges: LaidEdge[]; bands: LaidBand[]; width: number; height: number };

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
  const rootHeight =
    ROOT.pad * 2 + 15 + Math.max(1, goalLines.length) * ROOT.lineHeight +
    (constraintLines.length ? 6 + constraintLines.length * 16 : 0);

  const stages = (workflow.stages || []).slice(0, 6);
  const nodes: LaidNode[] = [];
  const edges: LaidEdge[] = [];
  const bands: LaidBand[] = [];

  /* 每行最多 3 个阶段：单行 5 个阶段时画布只有 ~60% 缩放、字会糊；
     折成 3+2 两行后，非全屏也能按接近 1:1 阅读，同时保留“阶段 1→2→3 ↓ 4→5”的流程语义。 */
  const PER_ROW = 6; // 单行流水线：全屏时能一屏看全；非全屏默认按 100% 显示、拖动查看，保证字号可读
  const ROW_GAP = 86;
  const firstStageX = ROOT.width + 96;

  type Prepared = {
    stage: (typeof stages)[number];
    index: number;
    accent: string;
    isCollapsed: boolean;
    headerHeight: number;
    blockHeight: number;
    kids: { child: NonNullable<(typeof stages)[number]["children"]>[number]; cm: ReturnType<typeof childMetrics> }[];
    x: number;
    y: number;
  };

  const prepared: Prepared[] = stages.map((stage, index) => {
    const accent = STAGE_ACCENTS[index % STAGE_ACCENTS.length];
    const isCollapsed = collapsed.has(stage.id);
    const metrics = stageMetrics(stage, isCollapsed);
    const kids = (isCollapsed ? [] : (stage.children || []).slice(0, 5)).map((child) => ({ child, cm: childMetrics(child) }));
    const kidsHeight = kids.reduce((sum, item) => sum + item.cm.height, 0) + Math.max(0, kids.length - 1) * 12;
    const blockHeight = metrics.height + (kids.length ? 30 + kidsHeight : 0);
    return { stage, index, accent, isCollapsed, headerHeight: metrics.height, blockHeight, kids, x: 0, y: 0 };
  });

  let rowTop = 0;
  for (let rowStart = 0; rowStart < prepared.length; rowStart += PER_ROW) {
    const row = prepared.slice(rowStart, rowStart + PER_ROW);
    const rowBlockHeight = Math.max(...row.map((item) => item.blockHeight));
    row.forEach((item, column) => {
      item.x = firstStageX + column * (STAGE.width + PIPELINE_GAP);
      item.y = rowTop;
    });
    rowTop += rowBlockHeight + ROW_GAP;
  }

  prepared.forEach((item) => {
    const { stage, index, accent, isCollapsed, headerHeight, kids, x, y } = item;
    const metrics = stageMetrics(stage, isCollapsed);
    nodes.push({
      id: stage.id,
      kind: "stage",
      x,
      y,
      width: STAGE.width,
      height: metrics.height,
      category: resolveCategory(stage.category, stage.title, stage.detail),
      titleLines: metrics.titleLines,
      detailLines: metrics.detailLines,
      hiddenCount: isCollapsed ? (stage.children?.length || 0) : 0,
      collapsed: isCollapsed,
      stageId: stage.id,
      accent,
      stageIndex: index + 1,
      childCount: (stage.children || []).length,
    });

    const childX = x + 26;
    const childWidth = STAGE.width - 26;
    let cursorY = y + headerHeight + 30;
    let lastCenterY = 0;
    kids.forEach(({ child, cm }, childIndex) => {
      lastCenterY = cursorY + cm.height / 2;
      nodes.push({
        id: child.id || `${stage.id}-${childIndex}`,
        kind: "child",
        x: childX,
        y: cursorY,
        width: childWidth,
        height: cm.height,
        category: resolveCategory(child.category, child.title, child.detail),
        titleLines: cm.titleLines,
        detailLines: cm.detailLines,
        hiddenCount: 0,
        collapsed: false,
        stageId: stage.id,
        accent,
        stageIndex: index + 1,
        childCount: 0,
        stepIndex: childIndex + 1,
      });
      edges.push({
        id: `e-${stage.id}-${childIndex}`,
        kind: "branch",
        accent,
        path: `M ${x + 13} ${lastCenterY} H ${childX - 4}`,
      });
      cursorY += cm.height + 12;
    });
    if (kids.length) {
      edges.push({
        id: `spine-${stage.id}`,
        kind: "branch",
        accent,
        path: `M ${x + 13} ${y + headerHeight} V ${lastCenterY}`,
      });
    }
    bands.push({ id: `band-${stage.id}`, x: x - 16, y: y - 16, width: STAGE.width + 32, height: item.blockHeight + 32, accent });
  });

  /* 流程箭头：同行向右；换行时从上一个阶段底部折到下一行第一个阶段顶部。 */
  prepared.forEach((item, index) => {
    const next = prepared[index + 1];
    if (!next) return;
    const arrowY = item.y + item.headerHeight / 2;
    if (next.y === item.y) {
      edges.push({ id: `flow-${index}`, kind: "flow", accent: item.accent, path: `M ${item.x + STAGE.width + 10} ${arrowY} H ${next.x - 14}` });
      edges.push({ id: `flow-head-${index}`, kind: "flow", accent: item.accent, path: `M ${next.x - 20} ${arrowY - 5} L ${next.x - 13} ${arrowY} L ${next.x - 20} ${arrowY + 5}` });
    } else {
      const startX = item.x + STAGE.width / 2;
      const startY = item.y + item.blockHeight;
      const endX = next.x + next.headerHeight / 2; // 端点用左侧卡片中心
      const midY = item.y + item.blockHeight + ROW_GAP / 2;
      edges.push({
        id: `flow-${index}`,
        kind: "flow",
        accent: item.accent,
        path: `M ${startX} ${startY} V ${midY} H ${next.x + STAGE.width / 2} V ${next.y - 14}`,
      });
      edges.push({
        id: `flow-head-${index}`,
        kind: "flow",
        accent: item.accent,
        path: `M ${next.x + STAGE.width / 2 - 5} ${next.y - 20} L ${next.x + STAGE.width / 2} ${next.y - 13} L ${next.x + STAGE.width / 2 + 5} ${next.y - 20}`,
      });
    }
  });

  const rootY = prepared.length ? prepared[0].headerHeight / 2 - rootHeight / 2 : 0;
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
    accent: STAGE_ACCENTS[0],
    stageIndex: 0,
    childCount: 0,
  });
  if (prepared.length) {
    const first = prepared[0];
    const arrowY = first.headerHeight / 2;
    edges.push({
      id: "root-flow",
      kind: "flow",
      accent: STAGE_ACCENTS[0],
      path: `M ${ROOT.width + 10} ${rootY + rootHeight / 2} H ${first.x - 14}`,
    });
    edges.push({
      id: "root-flow-head",
      kind: "flow",
      accent: STAGE_ACCENTS[0],
      path: `M ${first.x - 20} ${arrowY - 5} L ${first.x - 13} ${arrowY} L ${first.x - 20} ${arrowY + 5}`,
    });
  }

  const width = Math.max(ROOT.width, ...nodes.map((node) => node.x + node.width));
  const lastRowBottom = Math.max(...prepared.map((item) => item.y + item.blockHeight), 0);
  const height = Math.max(lastRowBottom, ...nodes.map((node) => node.y + node.height), 1);
  return { nodes, edges, bands, width, height };
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

  for (const band of layout.bands) {
    parts.push(`<rect x="${band.x}" y="${band.y}" width="${band.width}" height="${band.height}" rx="18" fill="${band.accent}" fill-opacity="0.06" stroke="${band.accent}" stroke-opacity="0.12" stroke-width="1"/>`);
  }
  for (const edge of layout.edges) {
    const opacity = edge.kind === "branch" ? 0.65 : 0.95;
    parts.push(`<path d="${edge.path}" fill="none" stroke="${edge.accent}" stroke-width="1.6" stroke-opacity="${opacity}" stroke-linecap="round"/>`);
  }

  for (const node of layout.nodes) {
    const isRoot = node.kind === "root";
    const isStage = node.kind === "stage";
    const fill = isRoot ? COLORS.primary : isStage ? COLORS.surface : COLORS.surface;
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="12" fill="${fill}" stroke="${COLORS.primaryLine}" stroke-width="1"/>`);
    if (!isRoot) {
      // 左侧强调色条 + 阶段/步骤序号：同一阶段同色，导出后也能一眼看出流程分组。
      if (isStage) parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="3" rx="1.5" fill="${node.accent}"/>`);
      parts.push(`<rect x="${node.x}" y="${node.y + 10}" width="4" height="${node.height - 20}" rx="2" fill="${node.accent}"/>`);
      const indexText = isStage ? String(node.stageIndex).padStart(2, "0") : `${node.stageIndex}.${node.stepIndex || 1}`;
      parts.push(`<text x="${node.x + node.width - 10}" y="${node.y + 18}" font-size="10" font-weight="700" fill="${node.accent}" text-anchor="end" letter-spacing=".5">${indexText}</text>`);
      if (isStage) parts.push(`<text x="${node.x + node.width - 10}" y="${node.y + node.height - 10}" font-size="10" fill="${COLORS.soft}" text-anchor="end">${node.childCount} 步</text>`);
    }

    if (isRoot) {
      parts.push(`<text x="${node.x + ROOT.pad}" y="${node.y + ROOT.pad + 9}" font-size="10" fill="#CFE4FF" letter-spacing="1">研究目标</text>`);
      node.titleLines.forEach((line, index) => {
        parts.push(`<text x="${node.x + ROOT.pad}" y="${node.y + ROOT.pad + 34 + index * ROOT.lineHeight}" font-size="${ROOT.titleSize}" font-weight="700" fill="#FFFFFF">${escapeXml(line)}</text>`);
      });
      const detailTop = node.y + node.height - ROOT.pad - node.detailLines.length * 16;
      node.detailLines.forEach((line, index) => {
        parts.push(`<text x="${node.x + ROOT.pad}" y="${detailTop + index * 16}" font-size="11" fill="#DCE9FA">${escapeXml(line)}</text>`);
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
    // 首次渲染是空态（workflow=null，视口 div 还没挂载）：必须等图表真正出现后再挂 observer，
    // 否则 viewport 恒为 0，fitView 永远提前返回，用户看到的就是"适配画布没反应"。
  }, [layout !== null]);

  const fitView = useCallback((next = layout) => {
    if (!next || !viewport.width || !viewport.height) return;
    const padding = 36;
    const scale = Math.min(
      (viewport.width - padding * 2) / Math.max(1, next.width),
      (viewport.height - padding * 2) / Math.max(1, next.height),
      1.1,
    );
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
    // 非全屏时 5 个阶段并排会被压到 60% 左右，字小到看不清；宁可默认 100%、左右拖动。
    const readable = clamped < 0.85 ? 1 : clamped;
    setView({
      scale: readable,
      x: (viewport.width - next.width * readable) / 2,
      y: (viewport.height - next.height * readable) / 2,
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
            {layout?.bands.map((band) => (
              <rect
                key={band.id}
                className="ew-band"
                x={band.x}
                y={band.y}
                width={band.width}
                height={band.height}
                rx={18}
                fill={band.accent}
                fillOpacity={0.06}
                stroke={band.accent}
                strokeOpacity={0.12}
                strokeWidth={1}
              />
            ))}
            {layout?.edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.path}
                className={`ew-edge ew-edge-path${edge.kind === "flow" ? " is-flow" : ""}`}
                style={{ stroke: edge.accent, opacity: edge.kind === "branch" ? 0.65 : 0.95, animationDelay: `${edge.kind === "flow" ? 60 : 160}ms` }}
              />
            ))}
            {layout?.nodes.map((node, index) => (
              <foreignObject key={node.id} x={node.x} y={node.y} width={node.width} height={node.height} className="ew-foreign">
                {node.kind === "root" ? (
                  <div className="ew-node ew-node-root" style={{ animationDelay: `${index * 45}ms` }}>
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
                  <div
                    className={`ew-node ew-node-stage${node.collapsed ? " is-collapsed" : ""}`}
                    style={{ "--ew-accent": node.accent, background: `${node.accent}0a`, animationDelay: `${index * 45}ms` } as CSSProperties}
                  >
                    <div className="ew-stage-head">
                      <span className="ew-stage-watermark" aria-hidden="true">{String(node.stageIndex).padStart(2, "0")}</span>
                      <span className="ew-stage-index">{String(node.stageIndex).padStart(2, "0")}</span>
                      <span className="ew-icon-slot">
                        <ExperimentIcon category={node.category} size={48} />
                      </span>
                      <div className="ew-stage-text">
                        <div className="ew-stage-title">
                          {node.titleLines.map((line, index) => <div key={index} className="ew-line">{line}</div>)}
                        </div>
                        {node.category && <span className="ew-stage-cat">{categoryById(node.category)?.short || ""}</span>}
                        <span className="ew-stage-count">{node.childCount} 步</span>
                      </div>
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
                  <div
                    className="ew-node ew-node-child"
                    style={{ "--ew-accent": node.accent, animationDelay: `${index * 45}ms` } as CSSProperties}
                  >
                    <div className="ew-child-head">
                      <span className="ew-step-index">{node.stageIndex}.{node.stepIndex}</span>
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
        <p className="ew-hint">画布可按住拖动 / 滚轮缩放；点「全屏」可一屏看完整流程。图标位对应 <code>public/icons/experiments/&lt;分类&gt;.png</code>，放入图片后刷新即可显示。</p>
      </div>
    </div>
  );
}
