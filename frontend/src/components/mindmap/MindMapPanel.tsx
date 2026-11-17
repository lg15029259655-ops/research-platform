"use client";

/**
 * 精读区「思维导图」面板：纯 SVG 渲染，不引入任何新依赖。
 *
 * 设计约束（见仓库外设计文档「精读思维导图」一节）：
 * - 根在中央、左右双向展开的层级树，三次贝塞尔连线；
 * - 节点按 kind 着色，inferred 节点虚线 + 「推断」角标；
 * - 折叠/展开、缩放 0.5–2x、适配、全屏、导出 SVG/PNG；
 * - 点击有 unit_ids 的节点回到 PDF 原文页。
 *
 * 导出时把 CSS 计算样式内联进 SVG（token 变量在序列化后会丢失），保证
 * 「屏幕上看到的」与「导出的文件」一致。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  collectIds,
  edgePath,
  kindColor,
  kindLabel,
  layoutMindmap,
  MINDMAP_LINE_HEIGHT,
  MINDMAP_PAGE_LINE_HEIGHT,
  type MindLayout,
  type MindMapPayload,
  type MindNode,
} from "@/lib/mindmap";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import "./mindmap.css";

export type { MindMapPayload, MindNode };

const PAD = 48;
const ZOOM_MIN = 0.28; // 节点多时需要更小缩放才能一屏看全（手动缩放同样放宽）
const ZOOM_MAX = 2;

type Props = {
  mindmap: MindMapPayload | null;
  pending: boolean;
  onJump: (unitId: string) => void;
};

/* 导出时需要内联的属性：只挑会参与视觉的，避免把布局属性也写死。 */
const INLINE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "font-size",
  "font-family",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "opacity",
];

function inlineComputedStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
  const sourceEls: Element[] = [source, ...Array.from(source.querySelectorAll("*"))];
  const cloneEls: Element[] = [clone, ...Array.from(clone.querySelectorAll("*"))];
  for (let index = 0; index < sourceEls.length && index < cloneEls.length; index += 1) {
    const computed = window.getComputedStyle(sourceEls[index]);
    for (const prop of INLINE_PROPS) {
      const value = computed.getPropertyValue(prop).trim();
      if (value && value !== "normal") cloneEls[index].setAttribute(prop, value);
    }
    cloneEls[index].removeAttribute("class");
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function MindMapPanel({ mindmap, pending, onJump }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailNode, setDetailNode] = useState<MindNode | null>(null);
  const [hoverBranch, setHoverBranch] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [exporting, setExporting] = useState<"svg" | "png" | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const userAdjusted = useRef(false);
  const fittedKey = useRef("");
  const clickTimer = useRef<number | null>(null);
  const pan = useRef<{ x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  /* 缩放/平移的镜像 ref：滚轮处理器需要"读旧值算新值"，不能放进 setState updater（会重复累加）。 */
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  const layout: MindLayout | null = useMemo(
    () => (mindmap ? layoutMindmap(mindmap.root, collapsed) : null),
    [mindmap, collapsed],
  );

  const paddedWidth = layout ? layout.width + PAD * 2 : 0;
  const paddedHeight = layout ? layout.height + PAD * 2 : 0;

  /* ---------- 尺寸与适配 ---------- */
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout !== null]);

  const zoomBy = useCallback((factor: number) => {
    const current = scaleRef.current;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor));
    if (Math.abs(next - current) < 0.001) return;
    const centerX = viewport.width / 2;
    const centerY = viewport.height / 2;
    const origin = offsetRef.current;
    setScale(next);
    setOffset({
      x: centerX - (centerX - origin.x) * (next / current),
      y: centerY - (centerY - origin.y) * (next / current),
    });
    userAdjusted.current = true;
  }, [viewport.height, viewport.width]);

  const fit = useCallback(() => {
    if (!layout || viewport.width < 40 || viewport.height < 40) return;
    const nextScale = Math.min(
      ZOOM_MAX,
      Math.max(
        ZOOM_MIN,
        Math.min((viewport.width - 32) / paddedWidth, (viewport.height - 32) / paddedHeight),
      ),
    );
    setScale(nextScale);
    setOffset({
      x: (viewport.width - paddedWidth * nextScale) / 2,
      y: (viewport.height - paddedHeight * nextScale) / 2,
    });
    userAdjusted.current = false;
  }, [layout, paddedHeight, paddedWidth, viewport.height, viewport.width]);

  /* 数据/论文切换时重置视图并适配；用户手动缩放后不再自动覆盖。 */
  useEffect(() => {
    const key = mindmap ? `${mindmap.paper_id}:${mindmap.parse_revision}` : "";
    if (key === fittedKey.current) return;
    fittedKey.current = key;
    userAdjusted.current = false;
    setSelectedId(null);
    setCollapsed(new Set());
    fit();
  }, [mindmap, fit]);

  useEffect(() => {
    if (!userAdjusted.current) fit();
  }, [fit, viewport.height, viewport.width]);

  /* ---------- 滚轮缩放（非 passive 才能 preventDefault） ---------- */
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const current = scaleRef.current;
      const factor = Math.exp(-event.deltaY * 0.0012);
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor));
      if (next === current) return;
      const ratio = next / current;
      const previous = offsetRef.current;
      const nextOffset = {
        x: cursorX - (cursorX - previous.x) * ratio,
        y: cursorY - (cursorY - previous.y) * ratio,
      };
      scaleRef.current = next;
      offsetRef.current = nextOffset;
      userAdjusted.current = true;
      setScale(next);
      setOffset(nextOffset);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  /* 全屏时锁滚动 + Esc 退出 */
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreen]);

  useEffect(() => () => {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
  }, []);

  /* ---------- 拖拽平移 ---------- */
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    pan.current = {
      x: event.clientX,
      y: event.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = pan.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    state.moved = true;
    userAdjusted.current = true;
    setOffset({ x: state.originX + dx, y: state.originY + dy });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (pan.current) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      pan.current = null;
    }
  }

  /* 一级分支配色：同一分支的连线和节点用同一颜色，看结构比看文字更快。 */
  const BRANCH_COLORS = ["#0A5AC2", "#0E7C86", "#7A5AF8", "#B26A00", "#2F80ED", "#5B7089"];
  const branchColor = useMemo(() => {
    const map = new Map<string, string>();
    if (!layout) return map;
    const sections = layout.nodes.filter((item) => item.depth === 1).sort((a, b) => a.y - b.y);
    sections.forEach((item, index) => map.set(item.id, BRANCH_COLORS[index % BRANCH_COLORS.length]));
    for (const item of layout.nodes) {
      if (item.depth >= 2 && item.parentId) map.set(item.id, map.get(item.parentId) || BRANCH_COLORS[0]);
    }
    return map;
  }, [layout]);

  /* 分支归属：hover 时只让当前分支保持不透明，其他分支淡化（Xmind「仅显示分支」的轻量版）。 */
  const branchOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of layout?.nodes ?? []) {
      if (item.depth === 0) continue;
      if (item.depth === 1) map.set(item.id, item.id);
      else if (item.parentId) map.set(item.id, map.get(item.parentId) || item.parentId);
    }
    return map;
  }, [layout]);
  const branchIndex = useMemo(() => {
    const map = new Map<string, number>();
    // 编号必须跟论文阅读顺序一致；按 y 排序会因为左右分支交错而出现 03/04 乱序。
    (mindmap?.root.children ?? []).forEach((child, index) => map.set(child.id, index + 1));
    (layout?.nodes ?? []).filter((item) => item.depth === 1 && !map.has(item.id))
      .forEach((item) => map.set(item.id, map.size + 1));
    return map;
  }, [mindmap, layout]);

  /* ---------- 节点交互 ---------- */
  function scheduleSelect(node: MindNode) {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      setSelectedId(node.id);
      setDetailNode(node);
    }, 180);
  }

  function toggleCollapse(id: string) {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const expandAll = useCallback(() => setCollapsed(new Set()), []);
  const collapseAll = useCallback(() => {
    if (!mindmap) return;
    setCollapsed(new Set(collectIds(mindmap.root).filter((id) => id !== mindmap.root.id)));
  }, [mindmap]);

  /* ---------- 导出 ---------- */
  const buildExportSvg = useCallback((): string | null => {
    const source = svgRef.current;
    if (!source || !mindmap || !layout) return null;
    const clone = source.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(paddedWidth));
    clone.setAttribute("height", String(paddedHeight));
    clone.setAttribute("viewBox", `${layout.bounds.minX - PAD} ${layout.bounds.minY - PAD} ${paddedWidth} ${paddedHeight}`);
    inlineComputedStyles(source, clone);
    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.setAttribute("x", String(layout.bounds.minX - PAD));
    background.setAttribute("y", String(layout.bounds.minY - PAD));
    background.setAttribute("width", String(paddedWidth));
    background.setAttribute("height", String(paddedHeight));
    background.setAttribute("fill", "#FFFFFF");
    clone.insertBefore(background, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }, [layout, mindmap, paddedHeight, paddedWidth]);

  async function exportSvg() {
    if (!mindmap || exporting) return;
    setExporting("svg");
    try {
      const markup = buildExportSvg();
      if (!markup) return;
      download(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), `mindmap-${mindmap.paper_id}.svg`);
    } finally {
      setExporting(null);
    }
  }

  async function exportPng() {
    if (!mindmap || exporting) return;
    setExporting("png");
    try {
      const markup = buildExportSvg();
      if (!markup) return;
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      const image = new Image();
      const drawable = new Promise<HTMLCanvasElement>((resolve, reject) => {
        image.onload = () => {
          const scaleFactor = 2;
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(paddedWidth * scaleFactor);
          canvas.height = Math.round(paddedHeight * scaleFactor);
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("当前浏览器不支持 Canvas 导出"));
            return;
          }
          context.fillStyle = "#FFFFFF";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas);
        };
        image.onerror = () => reject(new Error("SVG 转 PNG 失败"));
        image.src = url;
      });
      const canvas = await drawable;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) download(blob, `mindmap-${mindmap.paper_id}.png`);
    } catch {
      // 导出失败不阻塞页面：保持按钮可再次点击。
    } finally {
      setExporting(null);
    }
  }

  /* ---------- 渲染 ---------- */
  const kindsPresent = useMemo(() => {
    if (!mindmap) return [] as string[];
    const found = new Set<string>();
    const walk = (node: MindNode) => {
      found.add(node.kind);
      (node.children || []).forEach(walk);
    };
    walk(mindmap.root);
    return Array.from(found);
  }, [mindmap]);

  const head = (
    <header className="mm-head">
      <div className="mm-head-title">
        <span className="mm-kicker">MIND MAP</span>
        <strong>论文行文导图</strong>
        <small>点击节点看摘要 · 双击折叠分支</small>
      </div>
      <div className="mm-actions">
        <button type="button" className="mm-btn" onClick={expandAll} disabled={!mindmap}>展开全部</button>
        <button type="button" className="mm-btn" onClick={collapseAll} disabled={!mindmap}>折叠分支</button>
        <div className="mm-zoom" role="group" aria-label="缩放">
          <button type="button" onClick={() => zoomBy(1 / 1.2)} disabled={!mindmap} aria-label="缩小">−</button>
          <span aria-live="polite">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.2)} disabled={!mindmap} aria-label="放大">+</button>
        </div>
        <button type="button" className="mm-btn" onClick={fit} disabled={!mindmap}>适配画布</button>
        <button type="button" className="mm-btn" onClick={() => setFullscreen((value) => !value)} disabled={!mindmap}>
          {fullscreen ? "退出全屏" : "全屏"}
        </button>
        <button type="button" className="mm-btn" onClick={exportSvg} disabled={!mindmap || exporting !== null}>
          {exporting === "svg" ? "导出中…" : "导出 SVG"}
        </button>
        <button type="button" className="mm-btn" onClick={exportPng} disabled={!mindmap || exporting !== null}>
          {exporting === "png" ? "导出中…" : "导出 PNG"}
        </button>
      </div>
    </header>
  );

  const legend = (
    <footer className="mm-foot">
      {kindsPresent.length > 0 && (
        <div className="mm-legend">
          {kindsPresent.map((kind) => (
            <span key={kind}>
              <i style={{ background: kindColor(kind) }} aria-hidden="true" />
              {mindmap?.legend?.[kind] || kindLabel(kind)}
            </span>
          ))}
        </div>
      )}
      <small>
        按「问题 → 背景 → 方法 → 发现 → 证据 → 局限 → 贡献」分析维度整理；节点可点击看摘要并回到 PDF 对应页。
      </small>
    </footer>
  );

  let body;
  if (!mindmap) {
    body = pending ? (
      <div className="mm-state mm-loading" role="status" aria-live="polite">
        <div className="mm-skeleton" aria-hidden="true">
          <i /><i /><i /><i />
        </div>
        <strong>正在把论文章节整理成导图…</strong>
        <p>先建立章节骨架，再补充关键证据节点；完成后可折叠、缩放与导出。</p>
      </div>
    ) : (
      <div className="mm-state mm-empty">
        <span className="mm-empty-mark" aria-hidden="true">⌗</span>
        <strong>还没有这篇论文的思维导图</strong>
        <p>导图会在全文解析完成后生成；若刚重新识别过 PDF，需要重新生成一次。</p>
      </div>
    );
  } else if (layout) {
    body = (
      <div
        className="mm-viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-dragging={pan.current?.moved ? "true" : undefined}
      >
        <div
          className="mm-canvas"
          style={{
            width: paddedWidth,
            height: paddedHeight,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        >
          <svg
            ref={svgRef}
            className="mm-svg"
            width={paddedWidth}
            height={paddedHeight}
            viewBox={`${layout.bounds.minX - PAD} ${layout.bounds.minY - PAD} ${paddedWidth} ${paddedHeight}`}
            role="img"
            aria-label="论文行文导图"
          >
            <defs>
              <linearGradient id="mmRootGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0A5AC2" />
                <stop offset="100%" stopColor="#2F80ED" />
              </linearGradient>
            </defs>
            <rect
              x={layout.bounds.minX - PAD}
              y={layout.bounds.minY - PAD}
              width={paddedWidth}
              height={paddedHeight}
              fill="var(--c-surface)"
            />
            <g className="mm-anim" key={`${mindmap.paper_id}:${mindmap.parse_revision}`}>
            <g className="mm-edges">
              {layout.edges.map((edge) => (
                <path
                  key={edge.id}
                  d={edgePath(edge.from, edge.to)}
                  className="mm-edge-path"
                  style={{
                    animationDelay: `${edge.from.depth * 90}ms`,
                    stroke: branchColor.get(edge.to.id) || "var(--c-line-strong)",
                    strokeWidth: edge.from.depth === 0 ? 2.6 : 1.8,
                    opacity: hoverBranch && branchOf.get(edge.to.id) !== hoverBranch ? 0.08 : edge.from.depth === 0 ? 0.85 : 0.65,
                  }}
                />
              ))}
            </g>
            <g className="mm-nodes">
              {layout.nodes.map((item, index) => {
                const isRoot = item.depth === 0;
                const isSection = item.depth === 1;
                const isSelected = selectedId === item.id;
                const isHover = hoverId === item.id;
                const accent = isRoot ? "var(--c-primary)" : (branchColor.get(item.id) || kindColor(item.node.kind));
                const showBadge = item.node.inferred;
                return (
                  <g
                    key={item.id}
                    className={`mm-node${isSelected ? " is-selected" : ""}${isHover ? " is-hover" : ""}${isRoot ? " is-root" : isSection ? " is-section" : " is-point"}`}
                    transform={`translate(${item.x} ${item.y})`}
                    style={{ opacity: hoverBranch && item.depth > 0 && branchOf.get(item.id) !== hoverBranch ? 0.22 : 1, transition: "opacity 140ms ease" }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${kindLabel(item.node.kind)}：${item.node.label}`}
                    onClick={() => scheduleSelect(item.node)}
                    onDoubleClick={() => { if (item.hasChildren) toggleCollapse(item.id); }}
                    onMouseEnter={() => { setHoverId(item.id); setHoverBranch(branchOf.get(item.id) || null); }}
                    onMouseLeave={() => { setHoverId(null); setHoverBranch(null); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        scheduleSelect(item.node);
                      } else if (event.key === " ") {
                        event.preventDefault();
                        if (item.hasChildren) toggleCollapse(item.id);
                      }
                    }}
                  >
                    <g
                      className="mm-node-anim"
                      style={{ animationDelay: `${Math.min(index * 34, 480)}ms` }}
                    >
                    {isRoot ? (
                      <>
                        <rect
                          className="mm-node-bg"
                          x={-item.width / 2}
                          y={-item.height / 2}
                          width={item.width}
                          height={item.height}
                          rx={18}
                          ry={18}
                          fill="url(#mmRootGradient)"
                        />
                        <text x={-item.width / 2 + 22}>
                          {(() => {
                            const top = -(item.lines.length * MINDMAP_LINE_HEIGHT) / 2;
                            return item.lines.map((line, index) => (
                              <tspan
                                key={`t${index}`}
                                className="mm-root-text"
                                x={-item.width / 2 + 22}
                                y={top + 14 + index * MINDMAP_LINE_HEIGHT}
                              >
                                {line}
                              </tspan>
                            ));
                          })()}
                        </text>
                      </>
                    ) : isSection ? (
                      <>
                        <rect
                          className="mm-node-bg mm-section-bg"
                          x={-item.width / 2}
                          y={-item.height / 2}
                          width={item.width}
                          height={item.height}
                          rx={item.height / 2}
                          ry={item.height / 2}
                          style={{ fill: accent }}
                        />
                        <text x={-item.width / 2 + 18}>
                          {(() => {
                            const top = -(item.lines.length * MINDMAP_LINE_HEIGHT) / 2;
                            return item.lines.map((line, index) => (
                              <tspan
                                key={`t${index}`}
                                className="mm-section-text"
                                x={-item.width / 2 + 18}
                                y={top + 14 + index * MINDMAP_LINE_HEIGHT}
                              >
                                {line}
                              </tspan>
                            ));
                          })()}
                        </text>
                      </>
                    ) : (
                      <>
                        <rect
                          className="mm-node-bg mm-point-bg"
                          x={-item.width / 2}
                          y={-item.height / 2}
                          width={item.width}
                          height={item.height}
                          rx={10}
                          ry={10}
                        />
                        <rect
                          className="mm-point-bar"
                          x={-item.width / 2 + 1}
                          y={-item.height / 2 + 9}
                          width={3}
                          height={Math.max(12, item.height - 18)}
                          rx={1.5}
                          fill={accent}
                        />
                        <text x={-item.width / 2 + 18}>
                          {(() => {
                            const titleHeight = item.lines.length * MINDMAP_LINE_HEIGHT;
                            const pageHeight = item.pageLabel ? MINDMAP_PAGE_LINE_HEIGHT : 0;
                            const top = -(titleHeight + pageHeight) / 2;
                            return (
                              <>
                                {item.lines.map((line, index) => (
                                  <tspan
                                    key={`t${index}`}
                                    className="mm-point-text"
                                    x={-item.width / 2 + 18}
                                    y={top + 13 + index * MINDMAP_LINE_HEIGHT}
                                  >
                                    {line}
                                  </tspan>
                                ))}
                                {item.pageLabel && (
                                  <tspan
                                    className="mm-node-page"
                                    x={-item.width / 2 + 18}
                                    y={top + titleHeight + 10}
                                  >
                                    {item.pageLabel}
                                  </tspan>
                                )}
                              </>
                            );
                          })()}
                        </text>
                      </>
                    )}
                    {showBadge && (
                      <g className="mm-badge">
                        <rect x={item.width / 2 - 34} y={-item.height / 2 + 6} width={26} height={16} rx={8} ry={8} />
                        <text x={item.width / 2 - 21} y={-item.height / 2 + 18}>推断</text>
                      </g>
                    )}
                    </g>
                  </g>
                );
              })}
            </g>
            </g>
          </svg>
        </div>
      </div>
    );
  } else {
    body = <div className="mm-state mm-empty"><strong>导图数据为空</strong></div>;
  }

  return (
    <section className={`mm-panel${fullscreen ? " is-fullscreen" : ""}`} aria-label="论文行文导图">
      {head}
      {pending && mindmap && <div className="mm-refresh">正在更新导图…</div>}
      {body}
      {legend}
      {detailNode && (
        <EvidenceDrawer
          title={detailNode.label}
          eyebrow={`${kindLabel(detailNode.kind)} · ${detailNode.page ? `PDF 第 ${detailNode.page} 页` : "页码未知"}`}
          onClose={() => setDetailNode(null)}
          action={detailNode.unit_ids.length > 0 ? { label: "在 PDF 中查看原文 →", onClick: () => { onJump(detailNode.unit_ids[0]); setDetailNode(null); } } : undefined}
        >
          <p>{detailNode.detail || "该节点没有额外摘要；可回到原文核对。"}</p>
          {detailNode.inferred && <p className="miniNotice">这是 AI 推断节点，请以原文为准。</p>}
        </EvidenceDrawer>
      )}
    </section>
  );
}
