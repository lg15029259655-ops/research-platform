"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Group, OrthographicCamera } from "three";
import EvidenceDrawer from "@/components/EvidenceDrawer";

export type SimilarPaper = { openalex_id: string; title: string; similarity_level: string;
  differences: string[]; abstract?: string; year?: number | null; full_text_available?: boolean };
type Novelty = { query: string; similar_papers: SimilarPaper[]; similarity_level: string;
  novel_angles: string[]; evidence_scope: string; search_only?: boolean };
type Planet = { paper: SimilarPaper; position: [number, number, number]; color: string; size: number };

/* 三维材质读不到 CSS 变量，这里的三档色与 tokens.css 的 --c-tier-high / mid / low 同值，
   图例色点走 CSS 的那一份，改这里必须同步改 tokens.css，否则图例与球体又会不同色。 */
const levels = [["高", "高度相似", "#0A5AC2"], ["中", "部分相似", "#2F80ED"], ["低", "差异较大", "#5B7089"]] as const;

function FitOrbitCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const orthographic = camera as OrthographicCamera;
    orthographic.zoom = Math.min(55, size.width / 8, size.height / 5.5);
    orthographic.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function PlanetaryScene({ planets, onSelect, onHover, playing, searchOnly, selectedId }: {
  planets: Planet[]; onSelect: (paper: SimilarPaper) => void; onHover: (paper: SimilarPaper | null) => void; playing: boolean; searchOnly: boolean; selectedId: string | null;
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
        <mesh><sphereGeometry args={[.74, 28, 18]} /><meshBasicMaterial color="#4DA1FF" transparent opacity={.045} depthWrite={false} /></mesh>
      </group>
      {searchOnly ? <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[2.42, .012, 5, 160]} /><meshBasicMaterial color="#5B7089" transparent opacity={.56} /></mesh> : levels.map(([level, , color], i) => <mesh key={level} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[[1.55, 2.42, 3.26][i], .012, 5, 160]} /><meshBasicMaterial color={color} transparent opacity={.56} /></mesh>)}
      {planets.map(({ paper, position, color, size }) => <group key={paper.openalex_id} position={position}>
        <mesh onPointerOver={(event) => { event.stopPropagation(); setHovered(paper.openalex_id); onHover(paper); document.body.style.cursor = "pointer"; }} onPointerOut={() => { setHovered(null); onHover(null); document.body.style.cursor = ""; }} onClick={(event) => { event.stopPropagation(); onSelect(paper); }}>
          <sphereGeometry args={[selectedId === paper.openalex_id ? size * 1.35 : size, 32, 24]} /><meshPhysicalMaterial color={color} metalness={.03} roughness={.56} clearcoat={.08} clearcoatRoughness={.8} transparent opacity={selectedId && selectedId !== paper.openalex_id ? .32 : 1} />
        </mesh>
        {hovered === paper.openalex_id && <mesh><sphereGeometry args={[size * 1.4, 18, 12]} /><meshBasicMaterial color={color} transparent opacity={.11} depthWrite={false} /></mesh>}
      </group>)}
    </group>
    <OrbitControls enablePan={false} enableZoom minZoom={15} maxZoom={100} enableDamping dampingFactor={.07} rotateSpeed={.7} onStart={() => setInteracting(true)} onEnd={() => setInteracting(false)} />
  </>;
}

function Planetarium({ planets, onSelect, onHover, playing, searchOnly, selectedId }: {
  planets: Planet[]; onSelect: (paper: SimilarPaper) => void; onHover: (paper: SimilarPaper | null) => void; playing: boolean; searchOnly: boolean; selectedId: string | null;
}) {
  return <Canvas orthographic camera={{ position: [0, 6, 10], zoom: 55, near: 0.1, far: 100 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }} frameloop={playing ? "always" : "demand"}>
    <FitOrbitCamera />
    <PlanetaryScene planets={planets} onSelect={onSelect} onHover={onHover} playing={playing} searchOnly={searchOnly} selectedId={selectedId} />
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
  const planets = useMemo(() => novelty.search_only ? novelty.similar_papers.map((paper, index): Planet => {
    const angle = 2 * Math.PI * index / Math.max(novelty.similar_papers.length, 1) - .4;
    return {paper, color: "#5B7089", size: .16,
      position: [Math.cos(angle) * 2.42, 0, Math.sin(angle) * 2.42]};
  }) : levels.flatMap(([level, , color], tier) => {
    const group = novelty.similar_papers.filter((paper) => paper.similarity_level === level);
    const radius = [1.55, 2.42, 3.26][tier];
    return group.map((paper, index): Planet => {
      const angle = 2 * Math.PI * index / Math.max(group.length, 1) + tier * .38 - .4;
      return { paper, color, size: tier === 0 ? .18 : .15,
        position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius] };
    });
  }), [novelty.similar_papers, novelty.search_only]);
  return <div><div className="evidenceMapIntro"><strong>相似研究星系</strong><span>拖动旋转 · 滚轮缩放 · 点击行星查看文献</span></div>
    <div className="planetariumWrap" role="group" aria-label={novelty.search_only ? "相关文献三维展示，相似程度待核验" : "周围文献的三维相似性分层图"}>
      <div className="planetariumCanvas"><Planetarium planets={planets} onSelect={setSelected} onHover={setHovered} playing={playing} searchOnly={!!novelty.search_only} selectedId={selected?.openalex_id || null} /></div>
      <div className="planetariumHeading"><span>YOUR RESEARCH IDEA</span><strong title={novelty.query}>{novelty.query}</strong></div>
      <button className="planetariumMotion" type="button" onClick={() => setPlaying((value) => !value)}>{playing ? "暂停运动" : "继续运动"} {playing ? "Ⅱ" : "▶"}</button>
      {hovered && <div className="planetariumHover"><span>{novelty.search_only ? "相似程度待核验" : hovered.similarity_level === "高" ? "高度相似" : hovered.similarity_level === "中" ? "部分相似" : "差异较大"}</span><strong>{hovered.title}</strong><small>{hovered.year || "年份未知"} · 点击查看文献</small></div>}
      <div className="planetariumLegend">{novelty.search_only ? <span><i data-tier={2} />检索结果 · 待核验<b>{novelty.similar_papers.length}</b></span> : levels.map(([level, title], tier) => <span key={level}><i data-tier={tier} />{title}<b>{novelty.similar_papers.filter((paper) => paper.similarity_level === level).length}</b></span>)}</div>
    </div>
    <div className="planetariumIndex"><div className="planetariumIndexHead"><strong>周围文献</strong><span>{novelty.search_only ? "仅为检索结果；点击标题查看摘要" : "按相似层级排列；点击标题查看摘要与差异"}</span></div>{novelty.search_only ? <section className="planetariumTier"><div className="planetariumTierLabel"><i data-tier={2} /><strong>相似程度待核验</strong><span>{novelty.similar_papers.length} 篇</span></div><div className="planetariumPapers">{novelty.similar_papers.map((paper) => <button key={paper.openalex_id} onClick={() => setSelected(paper)} title={paper.title}><strong>{paper.title}</strong><small>{paper.year || "年份未知"} · 查看摘要 ↗</small></button>)}</div></section> : levels.map(([level, title], tier) => {
      const papers = novelty.similar_papers.filter((paper) => paper.similarity_level === level);
      return <section key={level} className="planetariumTier"><div className="planetariumTierLabel"><i data-tier={tier} /><strong>{title}</strong><span>{papers.length} 篇</span></div><div className="planetariumPapers">{papers.length ? papers.map((paper) => <button key={paper.openalex_id} onClick={() => setSelected(paper)} title={paper.title}><strong>{paper.title}</strong><small>{paper.year || "年份未知"} · 查看差异 ↗</small></button>) : <small>当前没有这一层级的研究</small>}</div></section>;
    })}</div>
    <p className="planetariumScope">{novelty.search_only ? "图中的文献位于同一轨道，只表示检索命中；位置和距离不表示相似程度。" : "轨道只表示高、中、低三个定性层级，不代表精确距离。"}{novelty.evidence_scope ? ` ${novelty.evidence_scope}` : ""} 尚未完成全文核验。</p>
    {!novelty.search_only && <div className="conceptAngles"><strong>值得进一步核验的角度</strong>{novelty.novel_angles.slice(0, 4).map((item, i) => <span key={i}>{item}</span>)}</div>}
    {selected && <EvidenceDrawer title={selected.title} eyebrow={novelty.search_only ? "检索文献 · 相似程度待核验" : `相似程度：${selected.similarity_level}`} onClose={() => setSelected(null)}><dl><dt>年份</dt><dd>{selected.year || "未知"}</dd><dt>证据范围</dt><dd>{selected.full_text_available ? "本地已有全文；本次新颖性判断仍只依据检索摘要" : "当前只有元数据或摘要，尚未全文核验"}</dd><dt>与想法差异</dt><dd>{selected.differences.join("；") || "需进一步对照原文"}</dd></dl><h4>检索摘要</h4><p>{selected.abstract || "OpenAlex 未提供摘要；未定位到具体原文位置。"}</p><div className="drawerActions"><button disabled={busy} aria-busy={busy} onClick={() => onView(selected)}>查看论文</button><button disabled={busy} aria-busy={busy} onClick={() => onAdd(selected)}>加入对比</button></div></EvidenceDrawer>}
  </div>;
}
