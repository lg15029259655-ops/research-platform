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
  type MindLayout,
  type MindMapPayload,
  type MindNode,
} from "@/lib/mindmap";
import "./mindmap.css";

export type { MindMapPayload, MindNode };

const PAD = 48;
const ZOOM_MIN = 0.5;
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

  /* ---------- 节点交互 ---------- */
  function scheduleSelect(node: MindNode) {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      setSelectedId(node.id);
      if (node.unit_ids.length > 0) onJump(node.unit_ids[0]);
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
        <strong>论文思维导图</strong>
        <small>点击节点回到原文 · 双击折叠分支</small>
      </div>
      <div className="mm-actions">
        <button type="button" className="mm-btn" onClick={expandAll} disabled={!mindmap}>展开全部</button>
        <button type="button" className="mm-btn" onClick={collapseAll} disabled={!mindmap}>折叠分支</button>
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
        导图由论文结构与原文单元整理；虚线节点为推断，需对照原文。点击节点可回到 PDF 对应页。
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
            aria-label="论文思维导图"
          >
            <rect
              x={layout.bounds.minX - PAD}
              y={layout.bounds.minY - PAD}
              width={paddedWidth}
              height={paddedHeight}
              fill="var(--c-surface)"
            />
            <g className="mm-edges">
              {layout.edges.map((edge) => (
                <path key={edge.id} d={edgePath(edge.from, edge.to)} />
              ))}
            </g>
            <g className="mm-nodes">
              {layout.nodes.map((item) => {
                const isRoot = item.depth === 0;
                const isSelected = selectedId === item.id;
                const isHover = hoverId === item.id;
                const accent = isRoot ? "var(--c-primary)" : kindColor(item.node.kind);
                const showBadge = item.node.inferred;
                return (
                  <g
                    key={item.id}
                    className={`mm-node${isSelected ? " is-selected" : ""}${isHover ? " is-hover" : ""}${isRoot ? " is-root" : ""}`}
                    transform={`translate(${item.x} ${item.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${kindLabel(item.node.kind)}：${item.node.label}`}
                    onClick={() => scheduleSelect(item.node)}
                    onDoubleClick={() => { if (item.hasChildren) toggleCollapse(item.id); }}
                    onMouseEnter={() => setHoverId(item.id)}
                    onMouseLeave={() => setHoverId(null)}
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
                    <rect
                      className="mm-node-bg"
                      x={-item.width / 2}
                      y={-item.height / 2}
                      width={item.width}
                      height={item.height}
                      rx={10}
                      ry={10}
                      stroke={accent}
                      strokeDasharray={showBadge ? "4 3" : undefined}
                    />
                    <circle cx={-item.width / 2 + 12} cy={0} r={3.5} fill={accent} />
                    {/* 多行文本：不再单行截断成"…"，行数由布局按折行结果算好，
                        整块文字在节点框内垂直居中。 */}
                    <text x={-item.width / 2 + 24}>
                      {item.lines.map((line, index) => (
                        <tspan
                          key={index}
                          x={-item.width / 2 + 24}
                          y={(-(item.lines.length - 1) * MINDMAP_LINE_HEIGHT) / 2 + index * MINDMAP_LINE_HEIGHT + 4.5}
                        >
                          {line}
                        </tspan>
                      ))}
                    </text>
                    {showBadge && (
                      <g className="mm-badge">
                        <rect x={item.width / 2 - 34} y={-9} width={26} height={16} rx={8} ry={8} />
                        <text x={item.width / 2 - 21} y={3}>推断</text>
                      </g>
                    )}
                    {item.hasChildren && (
                      <g
                        className="mm-toggle"
                        transform={`translate(${item.side * (item.width / 2 + 13)} 0)`}
                        role="button"
                        aria-label={item.collapsed ? "展开分支" : "折叠分支"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCollapse(item.id);
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <circle r={8} />
                        <text y={3.5}>{item.collapsed ? "+" : "−"}</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
    );
  } else {
    body = <div className="mm-state mm-empty"><strong>导图数据为空</strong></div>;
  }

  return (
    <section className={`mm-panel${fullscreen ? " is-fullscreen" : ""}`} aria-label="论文思维导图">
      {head}
      {pending && mindmap && <div className="mm-refresh">正在更新导图…</div>}
      {body}
      {legend}
    </section>
  );
}
