/**
 * 思维导图：纯数据布局（不碰 DOM），供 MindMapPanel 渲染与导出共用。
 *
 * 布局规则（与设计稿一致）：
 * - 根节点在中心，一级分支按子树高度左右均衡分配（左右双向树）；
 * - 同一侧的子孙沿该方向继续展开，深度决定横向距离；
 * - 纵向按子树高度做 tidy 排布，父节点垂直居中于其子节点；
 * - 折叠的节点不参与布局（但仍占位一个节点框）。
 *
 * 所有尺寸单位与 SVG 用户坐标一致（1 = 1px，缩放由外层 transform 负责）。
 */

export type MindNode = {
  id: string;
  label: string;
  kind: string;
  unit_ids: string[];
  page: number | null;
  inferred: boolean;
  children: MindNode[];
};

export type MindMapPayload = {
  paper_id: string;
  /** 后端用内容哈希（字符串）标识解析版本；为兼容旧接口保留 number。 */
  parse_revision: number | string;
  root: MindNode;
  legend: Record<string, string>;
};

/** 节点类型 → 颜色。与 mindmap.css 中的 --mm-* 变量保持同值；
 *  SVG 导出时直接写死十六进制，避免 CSS 变量在序列化后丢失。 */
export const KIND_COLORS: Record<string, string> = {
  question: "#0A5AC2",
  method: "#0E7C86",
  evidence: "#5B7089",
  finding: "#3D6B9E",
  limitation: "#8A5A12",
  extension: "#6E6291",
  title: "#23282F",
};

export const KIND_LABELS: Record<string, string> = {
  question: "研究问题",
  method: "方法",
  evidence: "证据",
  finding: "发现",
  limitation: "局限",
  extension: "延伸",
  title: "题目",
};

export function kindColor(kind: string): string {
  return KIND_COLORS[kind] || KIND_COLORS.evidence;
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind;
}

/* ---------- 布局常量 ---------- */
const LEVEL_GAP = 56; // 父子节点框之间的横向留白（不是中心距，宽度不同也不会重叠）
const SIBLING_GAP = 14; // 兄弟节点之间的纵向间距
const MAX_NODE_WIDTH = 236;
const MIN_NODE_WIDTH = 112;
const H_PADDING_LEFT = 24; // 左侧圆点 + 文字缩进
const H_PADDING_RIGHT = 16; // 右侧留白
const BADGE_RESERVE = 44; // “推断”角标占位，只在 inferred 节点上预留
export const MINDMAP_LINE_HEIGHT = 17; // 多行文本行高（与 MindMapPanel 渲染保持一致）
const V_PADDING = 9; // 节点上下内边距
const MIN_NODE_HEIGHT = 35;
const MAX_LINES = 5; // 超过才会出现省略号（后端标签 ≤24 字，正常不会触发）

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** 粗略文本宽度：CJK 约 13px/字，拉丁约 7px/字（字号 12.5px）。 */
export function measureLabel(label: string): number {
  let width = 0;
  for (const ch of label) width += CJK.test(ch) ? 13 : 7;
  return width;
}

export type NodeMetrics = {
  width: number;
  height: number;
  /** 折行后的文本行；渲染与导出都直接用它，避免再截断。 */
  lines: string[];
};

/**
 * 按像素宽度把标签折成多行。
 *
 * 之前是单行 truncateLabel，字数一多就变成“…”，用户看不到完整信息；
 * 这里改成折行 + 节点高度自适应：中文按字断行，英文尽量在空格处断，
 * 只有极端超长（超过 MAX_LINES 行）才在最后一行收尾加省略号。
 */
export function wrapLabel(label: string, maxWidth: number, maxLines = MAX_LINES): string[] {
  const chars = Array.from(label.trim());
  const lines: string[] = [];
  let line = "";
  let width = 0;
  let lastSpace = -1;
  const flush = (preferSpace: boolean) => {
    if (preferSpace && lastSpace > 0 && line.length > lastSpace) {
      const head = line.slice(0, lastSpace).trimEnd();
      const tail = line.slice(lastSpace).trimStart();
      lines.push(head);
      line = tail;
      width = measureLabel(tail);
    } else {
      lines.push(line.trimEnd());
      line = "";
      width = 0;
    }
    lastSpace = -1;
  };
  for (const ch of chars) {
    const charWidth = CJK.test(ch) ? 13 : 7;
    if (line.length > 0 && width + charWidth > maxWidth) flush(!CJK.test(ch));
    line += ch;
    width += charWidth;
    if (ch === " ") lastSpace = line.length;
  }
  if (line.trim().length) lines.push(line.trimEnd());
  if (lines.length === 0) return [""];
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
  return kept;
}

/** 节点尺寸由文本折行结果决定：短标签一行，长标签最多 5 行，节点高度随之增加。 */
export function nodeMetrics(node: MindNode): NodeMetrics {
  const badge = node.inferred ? BADGE_RESERVE : 0;
  const natural = Math.round(measureLabel(node.label)) + H_PADDING_LEFT + H_PADDING_RIGHT + badge;
  const width = Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH + badge, natural));
  const textWidth = Math.max(40, width - H_PADDING_LEFT - H_PADDING_RIGHT - badge);
  const lines = wrapLabel(node.label, textWidth);
  const height = Math.max(MIN_NODE_HEIGHT, lines.length * MINDMAP_LINE_HEIGHT + V_PADDING * 2);
  return { width, height, lines };
}

export type LaidMindNode = {
  id: string;
  node: MindNode;
  /** 节点中心坐标 */
  x: number;
  y: number;
  /** 该分支朝向：1=向右展开，-1=向左展开 */
  side: 1 | -1;
  /** 距根的层级 */
  depth: number;
  width: number;
  height: number;
  /** 折行后的文本行（渲染/导出直接使用，不再做单行截断）。 */
  lines: string[];
  hasChildren: boolean;
  collapsed: boolean;
  parentId: string | null;
};

export type LaidMindEdge = {
  id: string;
  from: LaidMindNode;
  to: LaidMindNode;
};

export type MindLayout = {
  nodes: LaidMindNode[];
  edges: LaidMindEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  width: number;
  height: number;
};

function childrenOf(node: MindNode, collapsed: Set<string>): MindNode[] {
  if (!node.children || collapsed.has(node.id)) return [];
  return node.children;
}

type MetricsFor = (node: MindNode) => NodeMetrics;

/* 子树高度按"该节点自身框高 vs 子节点堆叠高度"取大者；
   多行节点比单行高，所以这里必须用真实框高而不是固定 34px。 */
function subtreeHeight(
  node: MindNode,
  collapsed: Set<string>,
  metricsFor: MetricsFor,
  cache: Map<string, number>,
): number {
  const cached = cache.get(node.id);
  if (cached !== undefined) return cached;
  const own = metricsFor(node).height;
  const children = childrenOf(node, collapsed);
  const total =
    children.length === 0
      ? 0
      : children.reduce((sum, child) => sum + subtreeHeight(child, collapsed, metricsFor, cache), 0) +
        SIBLING_GAP * (children.length - 1);
  const value = Math.max(own, total);
  cache.set(node.id, value);
  return value;
}

function stackHeight(
  children: MindNode[],
  collapsed: Set<string>,
  metricsFor: MetricsFor,
  cache: Map<string, number>,
): number {
  if (children.length === 0) return 0;
  return (
    children.reduce((sum, child) => sum + subtreeHeight(child, collapsed, metricsFor, cache), 0) +
    SIBLING_GAP * (children.length - 1)
  );
}

/** 一级分支左右均衡：按子树高度从大到小贪心放进当前更矮的一侧。 */
function splitSides(
  children: MindNode[],
  collapsed: Set<string>,
  metricsFor: MetricsFor,
  cache: Map<string, number>,
): { right: MindNode[]; left: MindNode[] } {
  const items = children
    .map((child) => ({ child, height: subtreeHeight(child, collapsed, metricsFor, cache) }))
    .sort((a, b) => b.height - a.height);
  const right: MindNode[] = [];
  const left: MindNode[] = [];
  let rightHeight = 0;
  let leftHeight = 0;
  for (const item of items) {
    if (rightHeight <= leftHeight) {
      right.push(item.child);
      rightHeight += item.height;
    } else {
      left.push(item.child);
      leftHeight += item.height;
    }
  }
  // 保持原始顺序，避免每次渲染左右跳跃。
  const order = new Map(children.map((child, index) => [child.id, index]));
  const byOrder = (a: MindNode, b: MindNode) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  return { right: right.sort(byOrder), left: left.sort(byOrder) };
}

function place(
  node: MindNode,
  depth: number,
  side: 1 | -1,
  top: number,
  parent: LaidMindNode | null,
  collapsed: Set<string>,
  out: LaidMindNode[],
  edges: LaidMindEdge[],
  metricsFor: MetricsFor,
  heightCache: Map<string, number>,
): LaidMindNode {
  const metrics = metricsFor(node);
  const branchHeight = subtreeHeight(node, collapsed, metricsFor, heightCache);
  const children = childrenOf(node, collapsed);
  /* 横向位置按"父框右缘 + 留白 + 本框半宽"累加，节点宽度不同也不会压住父节点。 */
  const x = parent === null ? 0 : parent.x + side * (parent.width / 2 + LEVEL_GAP + metrics.width / 2);
  const laid: LaidMindNode = {
    id: node.id,
    node,
    x,
    y: top + branchHeight / 2,
    side,
    depth,
    width: metrics.width,
    height: metrics.height,
    lines: metrics.lines,
    hasChildren: (node.children?.length || 0) > 0,
    collapsed: collapsed.has(node.id),
    parentId: parent ? parent.id : null,
  };
  out.push(laid);
  if (parent) edges.push({ id: `${parent.id}->${node.id}`, from: parent, to: laid });
  let cursor = top;
  for (const child of children) {
    place(child, depth + 1, side, cursor, laid, collapsed, out, edges, metricsFor, heightCache);
    cursor += subtreeHeight(child, collapsed, metricsFor, heightCache) + SIBLING_GAP;
  }
  return laid;
}

/** 计算整棵树的布局。collapsed 中的节点不展开子节点。 */
export function layoutMindmap(root: MindNode, collapsed: Iterable<string> = []): MindLayout {
  const collapsedSet = new Set(collapsed);
  const nodes: LaidMindNode[] = [];
  const edges: LaidMindEdge[] = [];

  const metricCache = new Map<string, NodeMetrics>();
  const metricsFor: MetricsFor = (node) => {
    const cached = metricCache.get(node.id);
    if (cached) return cached;
    const metrics = nodeMetrics(node);
    metricCache.set(node.id, metrics);
    return metrics;
  };
  const heightCache = new Map<string, number>();

  const rootMetrics = metricsFor(root);
  const children = childrenOf(root, collapsedSet);
  const { right, left } = splitSides(children, collapsedSet, metricsFor, heightCache);
  const rightHeight = stackHeight(right, collapsedSet, metricsFor, heightCache);
  const leftHeight = stackHeight(left, collapsedSet, metricsFor, heightCache);

  const rootLaid: LaidMindNode = {
    id: root.id,
    node: root,
    x: 0,
    y: 0,
    side: 1,
    depth: 0,
    width: rootMetrics.width,
    height: rootMetrics.height,
    lines: rootMetrics.lines,
    hasChildren: (root.children?.length || 0) > 0,
    collapsed: collapsedSet.has(root.id),
    parentId: null,
  };
  nodes.push(rootLaid);

  let rightCursor = -rightHeight / 2;
  for (const child of right) {
    place(child, 1, 1, rightCursor, rootLaid, collapsedSet, nodes, edges, metricsFor, heightCache);
    rightCursor += subtreeHeight(child, collapsedSet, metricsFor, heightCache) + SIBLING_GAP;
  }
  let leftCursor = -leftHeight / 2;
  for (const child of left) {
    place(child, 1, -1, leftCursor, rootLaid, collapsedSet, nodes, edges, metricsFor, heightCache);
    leftCursor += subtreeHeight(child, collapsedSet, metricsFor, heightCache) + SIBLING_GAP;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of nodes) {
    minX = Math.min(minX, item.x - item.width / 2);
    maxX = Math.max(maxX, item.x + item.width / 2);
    minY = Math.min(minY, item.y - item.height / 2);
    maxY = Math.max(maxY, item.y + item.height / 2);
  }
  const bounds = { minX, minY, maxX, maxY };
  return { nodes, edges, bounds, width: maxX - minX, height: maxY - minY };
}

/** 三次贝塞尔连线：从父节点朝向子节点的一侧出，接到子节点朝向父节点的一侧。 */
export function edgePath(from: LaidMindNode, to: LaidMindNode): string {
  const dir = to.side;
  const x1 = from.x + dir * (from.width / 2);
  const y1 = from.y;
  const x2 = to.x - dir * (to.width / 2);
  const y2 = to.y;
  const handle = Math.max(24, Math.abs(x2 - x1) * 0.52);
  return `M ${x1} ${y1} C ${x1 + dir * handle} ${y1}, ${x2 - dir * handle} ${y2}, ${x2} ${y2}`;
}

/** 收集所有节点 id（用于「全部展开」）。 */
export function collectIds(root: MindNode): string[] {
  const ids: string[] = [];
  const walk = (node: MindNode) => {
    ids.push(node.id);
    (node.children || []).forEach(walk);
  };
  walk(root);
  return ids;
}
