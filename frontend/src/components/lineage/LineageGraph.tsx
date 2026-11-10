"use client";

/**
 * 文献谱系图（三维）。
 *
 * 语义来自 lineageLayout：半径=年份（越新越靠外），角度=领域簇，高度仅做轻微错层。
 * 渲染上只做两件事：静态渲染（frameloop="demand"，交互时 invalidate）+ 命中测试，
 * 不做力导向、不常驻 60fps。
 *
 * 依赖全部来自项目已有包：three / @react-three/fiber / @react-three/drei。
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as THREE from "three";
import {
  EDGE_COLORS,
  ROLE_COLORS,
  ROLE_LABELS,
  arrowTransform,
  buildLineageLayout,
  edgeCurve,
  inYearRange,
  truncateLabel,
  type CurvePoint,
  type LineageEdge,
  type LineageLayout,
  type LineageResponse,
  type PlacedNode,
} from "./lineageLayout";
import "./lineage.css";

type ControlsHandle = {
  reset: () => void;
};

type Props = {
  data: LineageResponse | null;
  selectedId?: string;
  onSelect: (id: string) => void;
  onRecenter: (id: string) => void;
  loading: boolean;
};

type EdgeModel = {
  id: string;
  relation: LineageEdge["relation"];
  source: string;
  target: string;
  points: CurvePoint[];
  arrow: { position: CurvePoint; direction: CurvePoint } | null;
};

const BG_FILL = "#0B1B33";
const BG_DEEP = "#071427";
const MAX_ARROWS = 200;
const MAX_INDIVIDUAL_NODES = 200;
const MAX_LABEL_NODES = 300;
const LABEL_ALWAYS = 48;

/* ---------- 颜色 ---------- */

function roleColor(role: string): string {
  return ROLE_COLORS[role] || ROLE_COLORS.reference;
}

function dimmedColor(hex: string): string {
  const color = new THREE.Color(hex);
  color.multiplyScalar(0.18);
  return `#${color.getHexString()}`;
}

/* ---------- 标签：canvas 纹理 sprite（不依赖网络字体） ---------- */

function makeLabelTexture(text: string, accent: string): { texture: THREE.CanvasTexture; aspect: number } {
  const width = 512;
  const height = 80;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d");
  if (context) {
    context.scale(2, 2);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(7, 20, 39, .82)";
    context.strokeStyle = "rgba(124, 162, 216, .45)";
    context.lineWidth = 1;
    const radius = 12;
    context.beginPath();
    context.moveTo(radius, 0.5);
    context.arcTo(width - 0.5, 0.5, width - 0.5, height - 0.5, radius);
    context.arcTo(width - 0.5, height - 0.5, 0.5, height - 0.5, radius);
    context.arcTo(0.5, height - 0.5, 0.5, 0.5, radius);
    context.arcTo(0.5, 0.5, width - 0.5, 0.5, radius);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = accent;
    context.font = '600 24px system-ui, "Microsoft YaHei", "Segoe UI", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, width / 2, height / 2 + 1, width - 28);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, aspect: width / height };
}

function LabelSprite({ text, position, accent }: { text: string; position: [number, number, number]; accent: string }) {
  const { texture, aspect } = useMemo(() => makeLabelTexture(text, accent), [text, accent]);
  useEffect(() => () => texture.dispose(), [texture]);
  const height = 0.46;
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={6}>
      <spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

/* ---------- 边：批量几何（一次 draw call 画完全部同色线） ---------- */

function buildLineGeometry(edges: EdgeModel[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const edge of edges) {
    for (let index = 1; index < edge.points.length; index += 1) {
      const previous = edge.points[index - 1];
      const current = edge.points[index];
      positions.push(previous[0], previous[1], previous[2], current[0], current[1], current[2]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function useLineGeometry(edges: EdgeModel[]): THREE.BufferGeometry {
  const geometry = useMemo(() => buildLineGeometry(edges), [edges]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

function buildArrowMatrices(edges: EdgeModel[]): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const edge of edges) {
    if (!edge.arrow) continue;
    const { position, direction } = edge.arrow;
    const target = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, target);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(position[0], position[1], position[2]),
      quaternion,
      new THREE.Vector3(1, 1, 1),
    );
    matrices.push(matrix);
  }
  return matrices;
}

function ArrowBatch({ edges, opacity }: { edges: EdgeModel[]; opacity: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const matrices = useMemo(() => buildArrowMatrices(edges), [edges]);
  const geometry = useMemo(() => new THREE.ConeGeometry(0.075, 0.22, 8), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#8FB4E8", transparent: true, opacity, toneMapped: false }),
    // opacity 通过下面 effect 更新，避免重建材质
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => { material.opacity = opacity; }, [material, opacity]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.count = matrices.length;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);
  if (matrices.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} frustumCulled={false} />;
}

function YearRings({ rings }: { rings: LineageLayout["rings"] }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const segments = 128;
    for (const ring of rings) {
      for (let index = 0; index < segments; index += 1) {
        const a0 = (index / segments) * Math.PI * 2;
        const a1 = ((index + 1) / segments) * Math.PI * 2;
        positions.push(
          Math.cos(a0) * ring.radius, -0.02, Math.sin(a0) * ring.radius,
          Math.cos(a1) * ring.radius, -0.02, Math.sin(a1) * ring.radius,
        );
      }
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return next;
  }, [rings]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (rings.length === 0) return null;
  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#2B527F" transparent opacity={0.42} />
    </lineSegments>
  );
}

/* ---------- 节点 ---------- */

function NodeMesh({
  placed,
  color,
  opacity,
  ringed,
  label,
  onHover,
  onSelect,
  onRecenter,
}: {
  placed: PlacedNode;
  color: string;
  opacity: number;
  ringed: boolean;
  label: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onRecenter: (id: string) => void;
}) {
  return (
    <group position={placed.position}>
      <mesh
        onPointerOver={(event) => { event.stopPropagation(); onHover(placed.id); }}
        onPointerOut={(event) => { event.stopPropagation(); onHover(null); }}
        onClick={(event) => { event.stopPropagation(); onSelect(placed.id); }}
        onDoubleClick={(event) => { event.stopPropagation(); onRecenter(placed.id); }}
      >
        <sphereGeometry args={[placed.radius, 22, 16]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={opacity}
          roughness={0.62}
          metalness={0.05}
        />
      </mesh>
      {ringed && (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[placed.radius * 1.52, 0.014, 8, 56]} />
          <meshBasicMaterial color={color} transparent opacity={0.6} toneMapped={false} />
        </mesh>
      )}
      {label && (
        <LabelSprite
          text={label}
          position={[0, placed.radius + 0.52, 0]}
          accent={color}
        />
      )}
    </group>
  );
}

function InstancedNodes({
  placed,
  activeId,
  adjacency,
  onHover,
  onSelect,
  onRecenter,
}: {
  placed: PlacedNode[];
  activeId: string | null;
  adjacency: Map<string, Set<string>>;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onRecenter: (id: string) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 14, 10), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 }),
    [],
  );
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  const colors = useMemo(() => {
    const neighbours = activeId ? adjacency.get(activeId) : null;
    return placed.map((item) => {
      const base = roleColor(item.node.role);
      if (!activeId) return new THREE.Color(base);
      const visible = item.id === activeId || neighbours?.has(item.id);
      return new THREE.Color(visible ? base : dimmedColor(base));
    });
  }, [placed, activeId, adjacency]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    placed.forEach((item, index) => {
      matrix.compose(
        new THREE.Vector3(item.position[0], item.position[1], item.position[2]),
        quaternion,
        new THREE.Vector3(item.radius, item.radius, item.radius),
      );
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, colors[index]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [placed, colors]);

  function idAt(instanceId: number | undefined | null): string | null {
    if (instanceId === undefined || instanceId === null) return null;
    return placed[instanceId]?.id ?? null;
  }

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, placed.length]}
      frustumCulled={false}
      onPointerMove={(event) => { const id = idAt(event.instanceId); if (id) onHover(id); }}
      onPointerOut={() => onHover(null)}
      onClick={(event) => { const id = idAt(event.instanceId); if (id) onSelect(id); }}
      onDoubleClick={(event) => { const id = idAt(event.instanceId); if (id) onRecenter(id); }}
    />
  );
}

/* ---------- 相机与交互 ---------- */

function CameraRig({ onReady }: { onReady: (handle: ControlsHandle) => void }) {
  const controlsRef = useRef<any>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    onReady({
      reset: () => {
        controlsRef.current?.reset();
        invalidate();
      },
    });
  }, [onReady, invalidate]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.65}
      zoomSpeed={0.8}
      minDistance={7}
      maxDistance={34}
      maxPolarAngle={Math.PI * 0.92}
      onStart={() => invalidate()}
      onChange={() => invalidate()}
    />
  );
}

/** frameloop="demand" 下，React 状态变化不会自动重绘；显式 invalidate。 */
function InvalidateOnChange({ values }: { values: unknown[] }) {
  const { invalidate } = useThree();
  const signature = values.map((value) => String(value)).join("|");
  useEffect(() => { invalidate(); }, [signature, invalidate]);
  return null;
}

function Entrance({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const { invalidate } = useThree();
  const progress = useRef(enabled ? 0 : 1);

  useFrame((_, delta) => {
    if (progress.current >= 1) return;
    progress.current = Math.min(1, progress.current + Math.min(delta, 0.05) * 1.9);
    const eased = 1 - Math.pow(1 - progress.current, 3);
    if (group.current) {
      group.current.scale.setScalar(0.92 + 0.08 * eased);
      group.current.rotation.y = -0.07 * (1 - eased);
    }
    invalidate();
  });

  return <group ref={group}>{children}</group>;
}

/* ---------- 场景 ---------- */

function Scene({
  layout,
  edges,
  selectedId,
  hoveredId,
  yearRange,
  onHover,
  onSelect,
  onRecenter,
  onControls,
  animate,
}: {
  layout: LineageLayout;
  edges: EdgeModel[];
  selectedId?: string;
  hoveredId: string | null;
  yearRange: [number, number] | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onRecenter: (id: string) => void;
  onControls: (handle: ControlsHandle) => void;
  animate: boolean;
}) {
  const activeId = hoveredId || selectedId || null;
  const neighbours = activeId ? layout.adjacency.get(activeId) : null;

  const visibleNodes = useMemo(
    () => layout.nodes.filter((item) => inYearRange(item.ringYear, yearRange)),
    [layout.nodes, yearRange],
  );

  const topCited = useMemo(() => {
    return new Set(
      [...layout.nodes]
        .sort((a, b) => (b.node.citation_count || 0) - (a.node.citation_count || 0))
        .slice(0, 8)
        .map((item) => item.id),
    );
  }, [layout.nodes]);

  const visibleIds = useMemo(() => new Set([layout.center.id, ...visibleNodes.map((item) => item.id)]), [layout.center.id, visibleNodes]);

  const citesEdges = useMemo(
    () => edges.filter((edge) => edge.relation === "cites" && visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [edges, visibleIds],
  );
  const relatedEdges = useMemo(
    () => edges.filter((edge) => edge.relation === "related" && visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [edges, visibleIds],
  );
  const highlightedEdges = useMemo(() => {
    if (!activeId) return [];
    return [...citesEdges, ...relatedEdges].filter(
      (edge) => edge.source === activeId || edge.target === activeId,
    );
  }, [activeId, citesEdges, relatedEdges]);

  const citesGeometry = useLineGeometry(citesEdges);
  const relatedGeometry = useLineGeometry(relatedEdges);
  const highlightGeometry = useLineGeometry(highlightedEdges);

  const showLabel = useCallback(
    (item: PlacedNode): boolean => {
      if (item.id === layout.center.id || item.id === selectedId || item.id === hoveredId) return true;
      if (layout.nodes.length > MAX_LABEL_NODES) return false;
      if (activeId) return neighbours?.has(item.id) || false;
      return layout.nodes.length <= LABEL_ALWAYS || topCited.has(item.id);
    },
    [activeId, hoveredId, layout.center.id, layout.nodes.length, neighbours, selectedId, topCited],
  );

  const labelFor = (item: PlacedNode): string | null =>
    showLabel(item) ? truncateLabel(item.node.title || "未提供标题") : null;

  const nodeOpacity = (item: PlacedNode): number => {
    if (!activeId) return 1;
    if (item.id === activeId) return 1;
    return neighbours?.has(item.id) ? 1 : 0.12;
  };

  const useInstancing = visibleNodes.length > MAX_INDIVIDUAL_NODES;

  return (
    <>
      <ambientLight intensity={1.15} />
      <directionalLight position={[10, 16, 12]} intensity={1.15} />
      <pointLight position={[-10, -6, -8]} intensity={0.35} color="#2F80ED" />
      <Entrance enabled={animate}>
        <YearRings rings={layout.rings} />
        <lineSegments geometry={relatedGeometry} frustumCulled={false}>
          <lineBasicMaterial color={EDGE_COLORS.related} transparent opacity={activeId ? 0.08 : 0.24} />
        </lineSegments>
        <lineSegments geometry={citesGeometry} frustumCulled={false}>
          <lineBasicMaterial color={EDGE_COLORS.cites} transparent opacity={activeId ? 0.1 : 0.55} />
        </lineSegments>
        {activeId && (
          <lineSegments geometry={highlightGeometry} frustumCulled={false}>
            <lineBasicMaterial color="#9CC4F5" transparent opacity={0.95} />
          </lineSegments>
        )}
        {citesEdges.length <= MAX_ARROWS && <ArrowBatch edges={citesEdges} opacity={activeId ? 0.18 : 0.8} />}

        <group position={[layout.center.position[0], layout.center.position[1], layout.center.position[2]]}>
          <NodeMesh
            placed={layout.center}
            color={ROLE_COLORS.center}
            opacity={activeId && layout.center.id !== activeId && !neighbours?.has(layout.center.id) ? 0.24 : 1}
            ringed
            label={truncateLabel(layout.center.node.title || "中心论文")}
            onHover={onHover}
            onSelect={onSelect}
            onRecenter={onRecenter}
          />
        </group>

        {useInstancing ? (
          <InstancedNodes
            placed={visibleNodes}
            activeId={activeId}
            adjacency={layout.adjacency}
            onHover={onHover}
            onSelect={onSelect}
            onRecenter={onRecenter}
          />
        ) : (
          visibleNodes.map((item) => (
            <NodeMesh
              key={item.id}
              placed={item}
              color={roleColor(item.node.role)}
              opacity={nodeOpacity(item)}
              ringed={item.id === selectedId}
              label={labelFor(item)}
              onHover={onHover}
              onSelect={onSelect}
              onRecenter={onRecenter}
            />
          ))
        )}
      </Entrance>
      <InvalidateOnChange
        values={[
          hoveredId,
          selectedId,
          yearRange?.[0] ?? null,
          yearRange?.[1] ?? null,
          layout.center.id,
          layout.nodes.length,
          visibleNodes.length,
        ]}
      />
      <CameraRig onReady={onControls} />
    </>
  );
}

/* ---------- 状态 ---------- */

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="lg-state">
      <span className="lg-state-mark" aria-hidden="true">◎</span>
      <strong>{title}</strong>
      <p>{hint}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="lg-state lg-loading" role="status" aria-live="polite">
      <div className="lg-skeleton" aria-hidden="true">
        <i className="lg-skeleton-core" />
        <i className="lg-skeleton-ring" />
        <i className="lg-skeleton-dot" />
      </div>
      <strong>正在读取文献谱系…</strong>
      <p>按年份与领域计算三维位置，并整理引用方向。</p>
    </div>
  );
}

function ListFallback({
  data,
  onSelect,
  onRecenter,
}: {
  data: LineageResponse;
  onSelect: (id: string) => void;
  onRecenter: (id: string) => void;
}) {
  const rows = [data.center as LineageResponse["center"] & { role?: string }, ...data.nodes.filter((node) => node.openalex_id !== data.center.openalex_id)];
  return (
    <div className="lg-fallback" role="list">
      <p className="lg-fallback-note">
        当前环境不支持 WebGL（或三维渲染失败），已降级为列表视图；功能不受影响。
      </p>
      {rows.slice(0, 120).map((node) => (
        <div className="lg-fallback-row" role="listitem" key={node.openalex_id}>
          <button type="button" className="lg-fallback-main" onClick={() => onSelect(node.openalex_id)}>
            <strong>{node.title || "未提供标题"}</strong>
            <small>
              {node.year || "年份未知"} · {node.journal || "来源未知"} · 被引 {node.citation_count || 0}
            </small>
          </button>
          {node.openalex_id !== data.center.openalex_id && (
            <button type="button" className="lg-fallback-action" onClick={() => onRecenter(node.openalex_id)}>
              以此为中心
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

class WebGLErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    return Boolean(context);
  } catch {
    return false;
  }
}

/* ---------- 主组件 ---------- */

export default function LineageGraph({ data, selectedId, onSelect, onRecenter, loading }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<ControlsHandle | null>(null);

  const layout = useMemo(() => (data ? buildLineageLayout(data) : null), [data]);

  const edges = useMemo<EdgeModel[]>(() => {
    if (!data || !layout) return [];
    const positionOf = new Map<string, CurvePoint>([[layout.center.id, layout.center.position]]);
    for (const item of layout.nodes) positionOf.set(item.id, item.position);
    const models: EdgeModel[] = [];
    for (const edge of data.edges) {
      if (edge.source === edge.target) continue;
      const from = positionOf.get(edge.source);
      const to = positionOf.get(edge.target);
      if (!from || !to) continue;
      const points = edgeCurve(from, to);
      models.push({
        id: `${edge.source}->${edge.target}:${edge.relation}`,
        relation: edge.relation,
        source: edge.source,
        target: edge.target,
        points,
        arrow: edge.relation === "cites" ? arrowTransform(points) : null,
      });
    }
    return models;
  }, [data, layout]);

  /* default year range */
  useEffect(() => {
    setYearRange(layout?.yearRange ?? null);
    setHoveredId(null);
  }, [layout]);

  useEffect(() => {
    setWebglOk(hasWebGL());
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const handleControls = useCallback((handle: ControlsHandle) => {
    controlsRef.current = handle;
  }, []);

  const resetView = useCallback(() => {
    controlsRef.current?.reset();
  }, []);

  const exportPng = useCallback(() => {
    const gl = glRef.current;
    if (!gl || !data) return;
    setExporting(true);
    try {
      const source = gl.domElement;
      const canvas = document.createElement("canvas");
      canvas.width = source.width;
      canvas.height = source.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, BG_FILL);
      gradient.addColorStop(1, BG_DEEP);
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `lineage-${data.center.openalex_id}.png`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, "image/png");
    } finally {
      setExporting(false);
    }
  }, [data]);

  const years = layout?.yearRange ?? null;
  const yearMin = years?.[0] ?? 0;
  const yearMax = years?.[1] ?? 0;
  const counts = layout ? { nodes: layout.nodes.length + 1, edges: edges.length } : { nodes: 0, edges: 0 };

  let body: ReactNode;
  if (loading && !data) {
    body = <LoadingSkeleton />;
  } else if (!data || !layout) {
    body = <EmptyState title="暂无文献谱系" hint="在上方检索论文后，点击「浏览文献关系」生成谱系图。" />;
  } else if (webglOk === false) {
    body = <ListFallback data={data} onSelect={onSelect} onRecenter={onRecenter} />;
  } else {
    body = (
      <WebGLErrorBoundary fallback={<ListFallback data={data} onSelect={onSelect} onRecenter={onRecenter} />}>
      <div className="lg-stage">
        <Canvas
          frameloop="demand"
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" }}
          camera={{ position: [0, 16, 21], fov: 42, near: 0.1, far: 120 }}
          onCreated={({ gl }) => { glRef.current = gl; }}
        >
          <Scene
            layout={layout}
            edges={edges}
            selectedId={selectedId}
            hoveredId={hoveredId}
            yearRange={yearRange}
            onHover={setHoveredId}
            onSelect={onSelect}
            onRecenter={onRecenter}
            onControls={handleControls}
            animate={!reducedMotion}
          />
        </Canvas>
        {loading && (
          <div className="lg-updating" role="status">
            <span className="lg-pulse" aria-hidden="true" />
            正在切换中心论文
          </div>
        )}
      </div>
      </WebGLErrorBoundary>
    );
  }

  return (
    <section className="lg-panel" aria-label="文献谱系图">
      <header className="lg-head">
        <div className="lg-title">
          <span className="lg-kicker">LITERATURE LINEAGE</span>
          <strong>文献谱系图</strong>
          <small>{counts.nodes} 个节点 · {counts.edges} 条关系 · 半径=年份，角度=领域</small>
        </div>
        <div className="lg-actions">
          {years && (
            <div className="lg-range" aria-label="年份过滤">
              <span>{yearRange?.[0] ?? yearMin}</span>
              <input
                type="range"
                min={yearMin}
                max={yearMax}
                value={yearRange?.[0] ?? yearMin}
                aria-label="起始年份"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setYearRange((current) => {
                    const upper = current?.[1] ?? yearMax;
                    return [Math.min(next, upper), upper];
                  });
                }}
              />
              <input
                type="range"
                min={yearMin}
                max={yearMax}
                value={yearRange?.[1] ?? yearMax}
                aria-label="结束年份"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setYearRange((current) => {
                    const lower = current?.[0] ?? yearMin;
                    return [lower, Math.max(next, lower)];
                  });
                }}
              />
              <span>{yearRange?.[1] ?? yearMax}</span>
            </div>
          )}
          <button type="button" className="lg-btn" onClick={resetView} disabled={!data}>重置视角</button>
          <button type="button" className="lg-btn" onClick={exportPng} disabled={!data || exporting}>
            {exporting ? "导出中…" : "导出 PNG"}
          </button>
        </div>
      </header>
      {body}
      <footer className="lg-foot">
        <div className="lg-legend">
          {(["center", "reference", "related", "cited_by"] as const).map((role) => (
            <span key={role}>
              <i style={{ background: ROLE_COLORS[role] }} aria-hidden="true" />
              {ROLE_LABELS[role]}
            </span>
          ))}
          <span className="lg-legend-line"><b aria-hidden="true">→</b> 引用方向（旧→新）</span>
          <span className="lg-legend-line"><b className="is-dashed" aria-hidden="true">┄</b> 相关研究</span>
        </div>
        <small>关系来自 OpenAlex 元数据；空间位置（年份环 × 领域扇区）用于阅读，不代表相关程度。</small>
      </footer>
    </section>
  );
}
