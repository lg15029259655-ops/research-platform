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
  /** 句子级要点摘要（后端新版本提供；旧数据没有时按普通节点渲染）。 */
  detail?: string;
  /** 跨页要点：起止页不同时显示页码范围。 */
  page_end?: number | null;
};

export type MindMapPayload = {
  paper_id: string;
  /** 后端用内容哈希（字符串）标识解析版本；为兼容旧接口保留 number。 */
  parse_revision: number | string;
  root: MindNode;
  legend: Record<string, string>;
  /** 三层结构统计：章节数 / 要点数 / 总节点数（旧数据没有时前端自行统计）。 */
  stats?: { sections: number; points: number; total: number };
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
  question: "问题/背景",
  method: "方法/数据",
  evidence: "证据/图表",
  finding: "发现",
  limitation: "局限/边界",
  extension: "贡献/启示",
  title: "题目",
};

export function kindColor(kind: string): string {
  return KIND_COLORS[kind] || KIND_COLORS.evidence;
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind;
}

/* ---------- 布局常量 ---------- */
const LEVEL_GAP = 48; // 父子节点框之间的横向留白
const SIBLING_GAP = 16; // 兄弟节点之间的纵向间距
const MAX_NODE_WIDTH = 268; // 普通节点最大宽度：超过才折行
const MIN_NODE_WIDTH = 88; // 短标签（如“数据与方法”）自动收窄，不再一律 200+
const ROOT_MAX_WIDTH = 320;
const ROOT_MIN_WIDTH = 232;
const H_PADDING_LEFT = 18; // 左侧色条/圆点 + 文字缩进
const H_PADDING_RIGHT = 16;
const BADGE_RESERVE = 40; // “推断”角标占位
export const MINDMAP_LINE_HEIGHT = 18;
export const MINDMAP_PAGE_LINE_HEIGHT = 13;
const V_PADDING = 10;
const MIN_NODE_HEIGHT = 36;

/** 句末标点/收尾符号：标签里出现“。”或单独一行“。”都很难看，统一去掉。 */
const TRAILING_PUNCT = /[。！？；;，,、：:.!?]+$/;
const CLOSING_PUNCT = "。，、；：！？）」』】.,!?;:)%";

/** 标签规范化：去首尾空白、去掉句末标点、去掉标点前的多余空格。 */
export function normalizeLabel(label: string): string {
  return label.trim()
    .replace(/\s+([，。；：！？、])/g, "$1")
    .replace(TRAILING_PUNCT, "")
    .trim();
}

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
  /** 页码脚注（如 "PDF p.3"）；根节点不显示，避免标题下多一行。 */
  pageLabel: string | null;
};

/**
 * 按像素宽度把标签折成多行。
 *
 * 之前是单行 truncateLabel，字数一多就变成“…”，用户看不到完整信息；
 * 这里改成折行 + 节点高度自适应：中文按字断行，英文尽量在空格处断，
 * 不再限制行数或加省略号：宁可节点变高，也要让用户看到完整短语。
 */
export function wrapLabel(label: string, maxWidth: number): string[] {
  const text = normalizeLabel(label);
  if (!text) return [""];
  const natural = measureLabel(text);
  if (natural <= maxWidth) return [text];

  const chars = Array.from(text);
  const lines: string[] = [];
  const linesNeeded = Math.max(2, Math.ceil(natural / Math.max(40, maxWidth)));
  const target = natural / linesNeeded;
  let line = "";
  let width = 0;

  for (const ch of chars) {
    const charWidth = CJK.test(ch) ? 13 : 7;
    const wouldOverflow = line.length > 0 && width + charWidth > maxWidth;
    const overTarget = line.length > 0 && width >= target && !CLOSING_PUNCT.includes(ch) && ch.trim() !== "";
    if (wouldOverflow || overTarget) {
      // 不把收尾标点甩到下一行：能塞进当前行就留在上一行。
      if (CLOSING_PUNCT.includes(ch) && width + charWidth <= maxWidth + 4) {
        line += ch;
        width += charWidth;
        lines.push(line.trimEnd());
      } else {
        lines.push(line.trimEnd());
        line = ch;
        width = charWidth;
      }
      continue;
    }
    line += ch;
    width += charWidth;
  }
  if (line.trim().length) lines.push(line.trimEnd());

  // 防止最后一行只剩 1–2 个字/一个标点：从上一行末尾挪一点字过来，凑成可读的一行。
  let guard = 0;
  while (lines.length > 1 && guard < 3) {
    const last = lines[lines.length - 1];
    if (last.replace(/\s/g, "").length > 2) break;
    const prev = lines[lines.length - 2];
    if (prev.length <= 6) break;
    const move = prev.slice(-3);
    lines[lines.length - 2] = prev.slice(0, -3).trimEnd();
    lines[lines.length - 1] = `${move}${last}`;
    guard += 1;
  }
  return lines.filter((item) => item.length > 0);
}

/** 节点尺寸由文本折行结果决定：标题行数 + 摘要行数共同决定高度。 */
export function nodeMetrics(node: MindNode): NodeMetrics {
  const isRoot = node.id === "root";
  const isSection = !isRoot && (node.children?.length || 0) > 0;
  const badge = node.inferred ? BADGE_RESERVE : 0;
  const label = normalizeLabel(node.label);
  const padLeft = isRoot ? 22 : H_PADDING_LEFT;
  const padRight = isRoot ? 22 : H_PADDING_RIGHT;
  const natural = Math.round(measureLabel(label)) + padLeft + padRight + badge;
  const maxWidth = isRoot ? ROOT_MAX_WIDTH : MAX_NODE_WIDTH;
  const minWidth = isRoot ? ROOT_MIN_WIDTH : MIN_NODE_WIDTH;
  // 关键：先按“一行放得下就不折行”定宽，字数少就窄框，不再所有框一样宽。
  const width = Math.max(minWidth + badge, Math.min(maxWidth, natural));
  const textWidth = Math.max(40, width - padLeft - padRight - badge);
  const lines = wrapLabel(label, textWidth);
  const pageLabel = node.page && !isRoot && !isSection ? `PDF p.${node.page}` : null;
  const contentHeight =
    lines.length * MINDMAP_LINE_HEIGHT + (pageLabel ? MINDMAP_PAGE_LINE_HEIGHT : 0);
  const height = Math.max(MIN_NODE_HEIGHT, contentHeight + V_PADDING * 2);
  return { width, height, lines, pageLabel };
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
  /** 页码脚注（根节点为空）。 */
  pageLabel: string | null;
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
    pageLabel: metrics.pageLabel,
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
    pageLabel: rootMetrics.pageLabel,
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

/** 统计节点总数（旧 payload 没有 stats 时前端自己算，用于判断是否默认折叠）。 */
export function countNodes(root: MindNode): number {
  let total = 0;
  const walk = (node: MindNode) => {
    total += 1;
    (node.children || []).forEach(walk);
  };
  walk(root);
  return total;
}

/** 一级章节节点 id：节点数量太多时默认只展开到这一层。 */
export function collectSectionIds(root: MindNode): string[] {
  return (root.children || []).filter((child) => (child.children?.length || 0) > 0).map((child) => child.id);
}
