"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { CanvasTexture, Group, Plane, SRGBColorSpace, Vector3 } from "three";

type Work = { openalex_id: string; title: string; citation_count: number; year?: number | null; journal?: string };
type Relation = { source: string; target: string; relation: string };
type Satellite = { work: Work; kind: "related" | "references"; initial: [number, number, number]; size: number };

function IndexTag({ position, index, selected }: { position: [number, number, number]; index: number; selected: boolean }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = 192; canvas.height = 96;
    const context = canvas.getContext("2d")!;
    context.fillStyle = selected ? "#244f43" : "#fffdfa";
    context.beginPath(); context.roundRect(4, 5, 184, 86, 28); context.fill();
    context.fillStyle = selected ? "#ffffff" : "#2d5248";
    context.font = "700 46px Arial"; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(String(index + 1).padStart(2, "0"), 96, 49);
    const result = new CanvasTexture(canvas); result.colorSpace = SRGBColorSpace; return result;
  }, [index, selected]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={[position[0], position[1] - .58, position[2]]} scale={[.54, .27, 1]}><spriteMaterial map={texture} transparent depthTest={false} /></sprite>;
}

function ResponsiveCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.position.set(0, size.width < 500 ? 1.2 : 1.1, size.width < 500 ? 14.2 : 9.8);
    camera.updateProjectionMatrix();
  }, [camera, size.width]);
  return null;
}

function Scene({ center, satellites, positions, move, selectedId, select, hover }: {
  center: string;
  satellites: Satellite[]; positions: Record<string, [number, number, number]>;
  move: (id: string, point: [number, number, number]) => void; selectedId?: string;
  select: (id: string) => void; hover: (id: string | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: string; plane: Plane; start: Vector3; moved: boolean } | null>(null);
  const constellation = useRef<Group>(null);
  const entrance = useRef(0);
  useLayoutEffect(() => {
    entrance.current = 0;
    if (constellation.current) {
      constellation.current.scale.setScalar(.78);
      constellation.current.rotation.y = -.13;
    }
  }, [center]);
  useFrame((_, delta) => {
    if (!constellation.current || entrance.current >= 1) return;
    entrance.current = Math.min(1, entrance.current + Math.min(delta, .05) * 1.7);
    const eased = 1 - Math.pow(1 - entrance.current, 3);
    constellation.current.scale.setScalar(.78 + .22 * eased);
    constellation.current.rotation.y = -.13 * (1 - eased);
  });
  function down(event: ThreeEvent<PointerEvent>, item: Satellite) {
    event.stopPropagation();
    const point = new Vector3(...(positions[item.work.openalex_id] || item.initial));
    drag.current = { id: item.work.openalex_id, plane: new Plane().setFromNormalAndCoplanarPoint(event.camera.getWorldDirection(new Vector3()), point), start: point, moved: false };
    setDragging(true);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }
  function moving(event: ThreeEvent<PointerEvent>) {
    const current = drag.current;
    if (!current) return;
    event.stopPropagation();
    const hit = event.ray.intersectPlane(current.plane, new Vector3());
    if (!hit) return;
    current.moved ||= hit.distanceTo(current.start) > .07;
    if (current.moved) move(current.id, [hit.x, hit.y, hit.z]);
  }
  function up(event: ThreeEvent<PointerEvent>) {
    if (!drag.current) return;
    event.stopPropagation();
    if (!drag.current.moved) select(drag.current.id);
    drag.current = null;
    setDragging(false);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }
  return <>
    <ambientLight intensity={1.75} /><directionalLight position={[5, 8, 8]} intensity={2.1} color="#ffffff" /><pointLight position={[-5, -2, 3]} intensity={2.4} color="#c2e6d6" />
    <group ref={constellation}>
    <mesh><sphereGeometry args={[.67, 48, 32]} /><meshPhysicalMaterial color="#245e52" metalness={.05} roughness={.53} clearcoat={.1} clearcoatRoughness={.8} /></mesh>
    <mesh><sphereGeometry args={[.99, 32, 20]} /><meshBasicMaterial color="#4c9a7f" transparent opacity={.065} depthWrite={false} /></mesh>
    <mesh rotation={[Math.PI / 2.8, .28, .15]}><torusGeometry args={[.88, .012, 5, 96]} /><meshBasicMaterial color="#5a9c83" transparent opacity={.45} /></mesh>
    {satellites.map((item, index) => {
      const id = item.work.openalex_id;
      const position = positions[id] || item.initial;
      const selected = id === selectedId;
      const color = item.kind === "references" ? "#b38951" : "#5c9a83";
      return <group key={id}>
        <Line points={[[0, 0, 0], [position[0] * .53, position[1] * .24, position[2] * .55], position]} color={color} opacity={selected ? .74 : .28} transparent lineWidth={selected ? 2 : 1} />
        <mesh position={position} onPointerDown={(event) => down(event, item)} onPointerMove={moving} onPointerUp={up}
          onPointerOver={(event) => { event.stopPropagation(); hover(id); document.body.style.cursor = "grab"; }}
          onPointerOut={() => { hover(null); document.body.style.cursor = ""; }}>
          <sphereGeometry args={[item.size, 32, 24]} /><meshPhysicalMaterial color={color} metalness={.03} roughness={.57} clearcoat={.09} clearcoatRoughness={.8} />
        </mesh>
        <IndexTag position={position} index={index} selected={selected} />
        {selected && <mesh position={position}><sphereGeometry args={[item.size * 1.35, 20, 14]} /><meshBasicMaterial color={color} transparent opacity={.09} depthWrite={false} /></mesh>}
      </group>;
    })}
    </group>
    <OrbitControls enabled={!dragging} enablePan minDistance={6.4} maxDistance={18} rotateSpeed={.66} enableDamping dampingFactor={.08} />
  </>;
}

export default function CitationGraph({ works, links, center, selectedId, onSelect }: {
  works: Work[]; links: Relation[]; center: string; selectedId?: string; onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [positionState, setPositionState] = useState<{ center: string; values: Record<string, [number, number, number]> }>({ center: "", values: {} });
  const [viewKey, setViewKey] = useState(0);
  const positions = positionState.center === center ? positionState.values : {};
  const workById = useMemo(() => new Map(works.map((work) => [work.openalex_id, work])), [works]);
  const groups = useMemo(() => {
    const related: Work[] = [], references: Work[] = [], seen = new Set<string>();
    for (const link of links) {
      const id = link.source === center ? link.target : link.source;
      const work = workById.get(id);
      if (!work || id === center || seen.has(id)) continue;
      seen.add(id);
      (link.relation === "references" ? references : related).push(work);
    }
    return { related, references };
  }, [links, center, workById]);
  const satellites = useMemo(() => {
    const items = [
      ...groups.related.slice(0, expanded ? undefined : 8).map((work) => ({ work, kind: "related" as const })),
      ...groups.references.slice(0, expanded ? undefined : 8).map((work) => ({ work, kind: "references" as const })),
    ];
    return items.map(({ work, kind }): Satellite => {
      const peers = kind === "related" ? groups.related : groups.references;
      const peerIndex = peers.findIndex((peer) => peer.openalex_id === work.openalex_id);
      const side = kind === "related" ? -1 : 1;
      const count = Math.min(peers.length, expanded ? peers.length : 8);
      const row = peerIndex % 5;
      const column = Math.floor(peerIndex / 5);
      const rowsInColumn = Math.min(5, count - column * 5);
      const y = (row - (rowsInColumn - 1) / 2) * 1.17 + (column ? .12 : 0);
      const x = side * (2.72 + column * 1.25 + (row % 2) * .38);
      const z = ((peerIndex * 3) % 5 - 2) * .25;
      return { work, kind, initial: [x, y, z] as [number, number, number],
        size: .28 + Math.min(.12, Math.sqrt(work.citation_count || 0) * .011) };
    });
  }, [groups, expanded]);
  const active = satellites.find((item) => item.work.openalex_id === hovered || item.work.openalex_id === selectedId);
  return <section className="graphCanvas bubbleGraph" aria-label="文献关系图">
    <header className="graphToolbar"><div><span className="graphKicker">LITERATURE NETWORK</span><strong>围绕中心论文探索</strong></div><div className="graphCounts"><span>相关研究 <b>{groups.related.length}</b></span><span>参考文献 <b>{groups.references.length}</b></span></div></header>
    <div className="bubbleGraphIntro"><strong title={workById.get(center)?.title}>{workById.get(center)?.title || "中心论文读取中"}</strong><span>拖动旋转视角 · 拖动节点调整位置 · 点击查看论文</span></div>
    <div className="bubbleMapStage bubbleThreeStage">
      <div className="networkClusterLabel related"><span>01 / DISCOVERY</span><strong>相关研究</strong><small>{groups.related.length} 篇 · 主题邻近</small></div>
      <div className="networkClusterLabel references"><span>02 / FOUNDATION</span><strong>参考文献</strong><small>{groups.references.length} 篇 · 引用来源</small></div>
      <Canvas key={viewKey} camera={{ position: [0, 1.3, 10], fov: 48 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <ResponsiveCamera />
        <Scene center={center} satellites={satellites} positions={positions} move={(id, point) => setPositionState((previous) => ({ center, values: { ...(previous.center === center ? previous.values : {}), [id]: point } }))} selectedId={selectedId} select={onSelect} hover={setHovered} />
      </Canvas>
      <div className="networkCenterLabel">中心论文</div>
      <div className="networkArrival" key={center} aria-live="polite"><span>EXPLORING PAPER</span><strong>{workById.get(center)?.title || "正在展开文献关系"}</strong><small>{groups.related.length} 篇相关研究 / {groups.references.length} 篇参考文献</small></div>
      <div className="bubbleLegend"><span><i className="core"/>中心论文</span><span><i className="related"/>相关研究</span><span><i className="references"/>参考文献</span></div>
      <button className="bubbleResetView" type="button" onClick={() => { setPositionState({ center, values: {} }); setViewKey((value) => value + 1); }}>重置视角与位置 ↺</button>
    </div>
    {active && <div className="bubbleSelection"><span>{active.kind === "related" ? "相关研究" : "参考文献"}</span><strong>{active.work.title}</strong><small>{active.work.year || "年份未知"} · 被引 {active.work.citation_count || 0}</small></div>}
    <footer className="networkFoot"><span>关系来自 OpenAlex 元数据；空间位置仅帮助浏览，不代表相关程度。</span><select aria-label="按标题选择关系图中的论文" value={selectedId || ""} onChange={(event) => onSelect(event.target.value)}><option value="">按标题选择论文</option>{satellites.map(({ work }) => <option key={work.openalex_id} value={work.openalex_id}>{work.title}</option>)}</select>{(groups.related.length > 8 || groups.references.length > 8) && <button onClick={() => setExpanded((value) => !value)}>{expanded ? "收起部分文献" : `显示全部 ${groups.related.length + groups.references.length} 篇`} ↗</button>}</footer>
  </section>;
}
