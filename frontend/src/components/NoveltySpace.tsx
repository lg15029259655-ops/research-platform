"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Group } from "three";
import EvidenceDrawer from "@/components/EvidenceDrawer";

export type SimilarPaper = { openalex_id: string; title: string; similarity_level: string;
  differences: string[]; abstract?: string; year?: number | null; full_text_available?: boolean };
type Novelty = { query: string; similar_papers: SimilarPaper[]; similarity_level: string;
  novel_angles: string[]; evidence_scope: string };
type Planet = { paper: SimilarPaper; level: "高" | "中" | "低"; position: [number, number, number]; color: string; size: number };

/* 三维材质读不到 CSS 变量，这里的三档色与 tokens.css 的 --c-tier-high / mid / low 同值，
   图例色点走 CSS 的那一份，改这里必须同步改 tokens.css，否则图例与球体又会不同色。 */
const levels = [["高", "高度相似", "#0A5AC2"], ["中", "部分相似", "#2F80ED"], ["低", "差异较大", "#5B7089"]] as const;

function PlanetaryScene({ planets, onSelect, onHover, playing }: {
  planets: Planet[]; onSelect: (paper: SimilarPaper) => void; onHover: (paper: SimilarPaper | null) => void; playing: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [interacting, setInteracting] = useState(false);
  const orbitRef = useRef<Group>(null);
  const coreRef = useRef<Group>(null);
  useFrame((_, delta) => {
    if (!interacting && playing && orbitRef.current) orbitRef.current.rotation.y += Math.min(delta, .05) * .075;
    if (playing && coreRef.current) coreRef.current.rotation.y += Math.min(delta, .05) * .16;
  });
  return <>
    <ambientLight intensity={1.65} /><directionalLight position={[5, 8, 7]} intensity={2.2} color="#ffffff" /><pointLight position={[-4, 3, 1]} intensity={3} color="#CFE4FF" />
    <group ref={orbitRef}>
      <group ref={coreRef}>
        <mesh><sphereGeometry args={[.62, 48, 32]} /><meshPhysicalMaterial color="#0A5AC2" metalness={.04} roughness={.52} clearcoat={.1} clearcoatRoughness={.8} /></mesh>
        <mesh rotation={[.3, .1, .18]}><torusGeometry args={[.81, .009, 6, 96]} /><meshBasicMaterial color="#4DA1FF" transparent opacity={.65} /></mesh>
        <mesh><sphereGeometry args={[.74, 28, 18]} /><meshBasicMaterial color="#4DA1FF" transparent opacity={.045} depthWrite={false} /></mesh>
      </group>
      {levels.map(([level, , color], i) => <mesh key={level} rotation={[Math.PI / 2 - [.06, .19, -.13][i], 0, 0]}><torusGeometry args={[[1.55, 2.42, 3.26][i], .012, 5, 160]} /><meshBasicMaterial color={color} transparent opacity={.56} /></mesh>)}
      {planets.map(({ paper, position, color, size }) => <group key={paper.openalex_id} position={position}>
        <mesh onPointerOver={(event) => { event.stopPropagation(); setHovered(paper.openalex_id); onHover(paper); document.body.style.cursor = "pointer"; }} onPointerOut={() => { setHovered(null); onHover(null); document.body.style.cursor = ""; }} onClick={(event) => { event.stopPropagation(); onSelect(paper); }}>
          <sphereGeometry args={[size, 32, 24]} /><meshPhysicalMaterial color={color} metalness={.03} roughness={.56} clearcoat={.08} clearcoatRoughness={.8} />
        </mesh>
        {hovered === paper.openalex_id && <mesh><sphereGeometry args={[size * 1.4, 18, 12]} /><meshBasicMaterial color={color} transparent opacity={.11} depthWrite={false} /></mesh>}
      </group>)}
    </group>
    <OrbitControls enablePan={false} enableZoom minDistance={6.5} maxDistance={14} enableDamping dampingFactor={.07} rotateSpeed={.7} onStart={() => setInteracting(true)} onEnd={() => setInteracting(false)} />
  </>;
}

function Planetarium({ planets, onSelect, onHover, playing }: {
  planets: Planet[]; onSelect: (paper: SimilarPaper) => void; onHover: (paper: SimilarPaper | null) => void; playing: boolean;
}) {
  return <Canvas camera={{ position: [0, 4.2, 7.4], fov: 38 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }} frameloop="always">
    <PlanetaryScene planets={planets} onSelect={onSelect} onHover={onHover} playing={playing} />
  </Canvas>;
}

export default function NoveltySpace({ novelty, busy, onView, onAdd }: {
  novelty: Novelty; busy: boolean; onView: (paper: SimilarPaper) => void;
  onAdd: (paper: SimilarPaper) => void;
}) {
  const [selected, setSelected] = useState<SimilarPaper | null>(null);
  const [hovered, setHovered] = useState<SimilarPaper | null>(null);
  // 运动敏感用户默认静止（ux-spec §6.2）；「暂停运动」按钮仍可手动继续。
  const [playing, setPlaying] = useState(() => !(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches));
  const planets = useMemo(() => levels.flatMap(([level, , color], tier) => {
    const group = novelty.similar_papers.filter((paper) => paper.similarity_level === level);
    const radius = [1.55, 2.42, 3.26][tier];
    const incline = [.06, .19, -.13][tier];
    return group.map((paper, index): Planet => {
      const angle = 2 * Math.PI * index / Math.max(group.length, 1) + tier * .38 - .4;
      return { paper, level, color, size: tier === 0 ? .18 : .15,
        position: [Math.cos(angle) * radius, Math.sin(angle) * radius * Math.sin(incline), Math.sin(angle) * radius * Math.cos(incline)] };
    });
  }), [novelty.similar_papers]);
  return <div><div className="evidenceMapIntro"><strong>相似研究星系</strong><span>拖动旋转 · 滚轮缩放 · 点击行星查看文献</span></div>
    <div className="planetariumWrap" role="group" aria-label="周围文献的三维相似性分层图">
      <div className="planetariumCanvas"><Planetarium planets={planets} onSelect={setSelected} onHover={setHovered} playing={playing} /></div>
      <div className="planetariumHeading"><span>YOUR RESEARCH IDEA</span><strong title={novelty.query}>{novelty.query}</strong></div>
      <button className="planetariumMotion" type="button" onClick={() => setPlaying((value) => !value)}>{playing ? "暂停运动" : "继续运动"} {playing ? "Ⅱ" : "▶"}</button>
      {hovered && <div className="planetariumHover"><span>{hovered.similarity_level === "高" ? "高度相似" : hovered.similarity_level === "中" ? "部分相似" : "差异较大"}</span><strong>{hovered.title}</strong><small>{hovered.year || "年份未知"} · 点击查看研究差异</small></div>}
      <div className="planetariumLegend">{levels.map(([level, title], tier) => <span key={level}><i data-tier={tier} />{title}<b>{novelty.similar_papers.filter((paper) => paper.similarity_level === level).length}</b></span>)}</div>
    </div>
    <div className="planetariumIndex"><div className="planetariumIndexHead"><strong>周围文献</strong><span>按相似层级排列；点击标题查看摘要与差异</span></div>{levels.map(([level, title], tier) => {
      const papers = novelty.similar_papers.filter((paper) => paper.similarity_level === level);
      return <section key={level} className="planetariumTier"><div className="planetariumTierLabel"><i data-tier={tier} /><strong>{title}</strong><span>{papers.length} 篇</span></div><div className="planetariumPapers">{papers.length ? papers.map((paper) => <button key={paper.openalex_id} onClick={() => setSelected(paper)} title={paper.title}><strong>{paper.title}</strong><small>{paper.year || "年份未知"} · 查看差异 ↗</small></button>) : <small>当前没有这一层级的研究</small>}</div></section>;
    })}</div>
    <p className="planetariumScope">轨道只表示高、中、低三个定性层级，不代表精确距离。{novelty.evidence_scope} 判断基于检索摘要，尚未完成全文核验。</p>
    <div className="conceptAngles"><strong>值得进一步核验的角度</strong>{novelty.novel_angles.slice(0, 4).map((item, i) => <span key={i}>{item}</span>)}</div>
    {selected && <EvidenceDrawer title={selected.title} eyebrow={`相似程度：${selected.similarity_level}`} onClose={() => setSelected(null)}><dl><dt>年份</dt><dd>{selected.year || "未知"}</dd><dt>证据范围</dt><dd>{selected.full_text_available ? "本地已有全文；本次新颖性判断仍只依据检索摘要" : "当前只有元数据或摘要，尚未全文核验"}</dd><dt>与想法差异</dt><dd>{selected.differences.join("；") || "需进一步对照原文"}</dd></dl><h4>检索摘要</h4><p>{selected.abstract || "OpenAlex 未提供摘要；未定位到具体原文位置。"}</p><div className="drawerActions"><button disabled={busy} aria-busy={busy} onClick={() => onView(selected)}>查看论文</button><button disabled={busy} aria-busy={busy} onClick={() => onAdd(selected)}>加入对比</button></div></EvidenceDrawer>}
  </div>;
}
