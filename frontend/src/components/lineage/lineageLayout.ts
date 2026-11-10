/**
 * 文献谱系图：数据 → 三维坐标的确定性布局。
 *
 * 语义（与设计文档「谱系图重设计」一致）：
 * - 半径 = 年份：中心论文在原点，越早的文献越靠内圈，越新的越靠外圈（读作"时间从中心向外"）；
 * - 角度 = 领域簇：同一 domain 的文献落在同一扇区，扇区大小按篇数分配；
 * - 高度 = 轻微抖动，只为避免共面遮挡，不承载语义。
 *
 * 不做力导向、不做随机撒点：同样的数据永远得到同样位置（可截图、可回溯）。
 */

export type LineageWork = {
  openalex_id: string;
  title: string;
  authors: string[];
  year: number | null;
  journal: string;
  doi: string;
  abstract: string;
  citation_count: number;
  oa_pdf_url: string | null;
  domain?: string;
  study_type?: string;
};

/** 后端 /api/research/lineage 的 nodes 里也包含中心论文（role="center"）。 */
export type LineageRole = "center" | "reference" | "related" | "cited_by";

export type LineageNode = LineageWork & { role: LineageRole };

export type LineageEdge = {
  source: string;
  target: string;
  relation: "cites" | "related";
};

export type LineageResponse = {
  center: LineageWork;
  nodes: LineageNode[];
  edges: LineageEdge[];
  cached: boolean;
  fetched_at: string;
};

/** 节点颜色：与 tokens.css 的 --c-graph-* 同色系；中心用主色，被引文献用紫灰区分。 */
export const ROLE_COLORS: Record<string, string> = {
  center: "#0A5AC2",
  reference: "#5B7089",
  related: "#2F80ED",
  cited_by: "#7A5AF8",
};

export const ROLE_LABELS: Record<string, string> = {
  center: "中心论文",
  reference: "参考文献",
  related: "相关研究",
  cited_by: "被引文献",
};

export const EDGE_COLORS = {
  cites: "#4C7FC4",
  related: "#2F80ED",
};

export type PlacedNode = {
  id: string;
  node: LineageNode;
  position: [number, number, number];
  radius: number;
  ringYear: number | null;
};

export type YearRing = { year: number; radius: number };

export type LineageLayout = {
  center: PlacedNode;
  nodes: PlacedNode[];
  rings: YearRing[];
  yearRange: [number, number] | null;
  /** 无向邻接表，仅用于 hover 高亮 */
  adjacency: Map<string, Set<string>>;
  maxRadius: number;
};

const INNER_RADIUS = 4;
const OUTER_RADIUS = 12.5;
const BASE_NODE_RADIUS = 0.2;
const MAX_NODE_RADIUS = 0.62;

/** 稳定哈希：同一 openalex_id 永远得到同一个 [0,1) 值。 */
function hash01(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

export function nodeRadius(citationCount: number, maxCitation: number, isCenter: boolean): number {
  const ratio = maxCitation > 0 ? Math.sqrt(Math.max(0, citationCount)) / Math.sqrt(maxCitation) : 0;
  const base = BASE_NODE_RADIUS + (MAX_NODE_RADIUS - BASE_NODE_RADIUS) * Math.min(1, ratio);
  return isCenter ? Math.min(0.8, base * 1.35) : base;
}

function dominantDomain(node: LineageNode): string {
  return node.domain && node.domain !== "general" ? node.domain : "跨领域";
}

export function buildLineageLayout(data: LineageResponse): LineageLayout {
  const centerId = data.center.openalex_id;
  const satellites = data.nodes.filter((node) => node.openalex_id !== centerId);
  const maxCitation = satellites.reduce((max, node) => Math.max(max, node.citation_count || 0), 0);

  const centerNode: LineageNode = {
    ...data.center,
    role: "reference",
  };
  const centerPlaced: PlacedNode = {
    id: centerId,
    node: centerNode,
    position: [0, 0, 0],
    radius: nodeRadius(data.center.citation_count || 0, maxCitation, true),
    ringYear: data.center.year,
  };

  const years = satellites
    .map((node) => node.year)
    .filter((year): year is number => typeof year === "number" && year > 0);
  const uniqueYears = Array.from(new Set(years)).sort((a, b) => a - b);
  const minYear = uniqueYears.length > 0 ? uniqueYears[0] : 0;
  const maxYear = uniqueYears.length > 0 ? uniqueYears[uniqueYears.length - 1] : 0;
  const yearSpan = maxYear - minYear;

  const ringRadius = (year: number | null): number => {
    if (year === null || uniqueYears.length === 0) return (INNER_RADIUS + OUTER_RADIUS) / 2;
    if (yearSpan === 0) return 6.5;
    const ratio = (year - minYear) / yearSpan;
    return INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) * ratio;
  };

  /* 领域扇区：按篇数分配角度，domain 名排序保证稳定。 */
  const groups = new Map<string, LineageNode[]>();
  for (const node of satellites) {
    const key = dominantDomain(node);
    const bucket = groups.get(key);
    if (bucket) bucket.push(node);
    else groups.set(key, [node]);
  }
  const groupKeys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const gap = groupKeys.length > 1 ? 0.16 : 0;
  const usable = Math.PI * 2 - gap * groupKeys.length;
  const total = satellites.length || 1;

  const placed: PlacedNode[] = [];
  let cursor = -Math.PI / 2;

  for (const key of groupKeys) {
    const bucket = groups.get(key) || [];
    const sector = (usable * bucket.length) / total;
    const ordered = [...bucket].sort((a, b) => {
      const yearDiff = (a.year ?? 0) - (b.year ?? 0);
      return yearDiff !== 0 ? yearDiff : a.openalex_id.localeCompare(b.openalex_id);
    });
    ordered.forEach((node, index) => {
      const jitterAngle = (hash01(node.openalex_id) - 0.5) * (sector / bucket.length) * 0.6;
      const angle = cursor + (sector * (index + 0.5)) / bucket.length + jitterAngle;
      const radius = ringRadius(node.year);
      const height = (hash01(`${node.openalex_id}:y`) - 0.5) * 0.9;
      placed.push({
        id: node.openalex_id,
        node,
        position: [Math.cos(angle) * radius, height, Math.sin(angle) * radius],
        radius: nodeRadius(node.citation_count || 0, maxCitation, false),
        ringYear: node.year,
      });
    });
    cursor += sector + gap;
  }

  const adjacency = new Map<string, Set<string>>();
  adjacency.set(centerId, new Set());
  for (const item of placed) adjacency.set(item.id, new Set());
  for (const edge of data.edges) {
    if (edge.source === edge.target) continue;
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const rings: YearRing[] = uniqueYears.map((year) => ({ year, radius: ringRadius(year) }));

  return {
    center: centerPlaced,
    nodes: placed,
    rings,
    yearRange: uniqueYears.length > 1 ? [minYear, maxYear] : null,
    adjacency,
    maxRadius: OUTER_RADIUS + 0.8,
  };
}

/** 平移到目标区间之外时返回 false，用于年份过滤。 */
export function inYearRange(year: number | null, range: [number, number] | null): boolean {
  if (!range) return true;
  if (year === null) return true;
  return year >= range[0] && year <= range[1];
}

export type CurvePoint = [number, number, number];

/** 边：从 source 到 target 的二次贝塞尔弧（抬高中点，避免穿模）。 */
export function edgeCurve(from: CurvePoint, to: CurvePoint, samples = 18): CurvePoint[] {
  const lift = 0.7 + Math.hypot(to[0] - from[0], to[2] - from[2]) * 0.16;
  const control: CurvePoint = [
    (from[0] + to[0]) / 2,
    Math.max(from[1], to[1]) + lift,
    (from[2] + to[2]) / 2,
  ];
  const points: CurvePoint[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const oneMinus = 1 - t;
    points.push([
      oneMinus * oneMinus * from[0] + 2 * oneMinus * t * control[0] + t * t * to[0],
      oneMinus * oneMinus * from[1] + 2 * oneMinus * t * control[1] + t * t * to[1],
      oneMinus * oneMinus * from[2] + 2 * oneMinus * t * control[2] + t * t * to[2],
    ]);
  }
  return points;
}

/** 箭头位置与朝向：取曲线 88% 处的点与切线。 */
export function arrowTransform(points: CurvePoint[]): { position: CurvePoint; direction: CurvePoint } {
  const index = Math.max(1, Math.floor(points.length * 0.88));
  const position = points[index];
  const previous = points[index - 1];
  const direction: CurvePoint = [
    position[0] - previous[0],
    position[1] - previous[1],
    position[2] - previous[2],
  ];
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  return {
    position,
    direction: [direction[0] / length, direction[1] / length, direction[2] / length],
  };
}

export function truncateLabel(label: string, limit = 24): string {
  const trimmed = label.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}
