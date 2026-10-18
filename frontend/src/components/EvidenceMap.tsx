"use client";

import Link from "next/link";
import { useState } from "react";
import EvidenceDrawer from "@/components/EvidenceDrawer";

type Ref = { paper_id: string; unit_id: string; section: string; page: number | null; snippet: string };
export type Claim = { claim: string; paper_ids: string[]; stance: "SUPPORTS" | "REFUTES" | "INSUFFICIENT";
  reason: string; evidence_refs?: Ref[] };
type Paper = { paper_id: string; title: string };
const columns = [["SUPPORTS", "支持", "现有证据支持"], ["REFUTES", "结果不一致", "存在相反或不一致的结果"],
  ["INSUFFICIENT", "证据不足", "当前资料不足以判断"]] as const;

export default function EvidenceMap({ claims, papers, onReviseSelection }: {
  claims: Claim[]; papers: Paper[]; onReviseSelection?: () => void;
}) {
  const [selected, setSelected] = useState<Claim | null>(null);
  const visibleClaims = claims;
  const title = (id: string) => papers.find((item) => item.paper_id === id)?.title || "未知论文";
  const hasDirectRelation = visibleClaims.some((item) => item.stance === "SUPPORTS" || item.stance === "REFUTES");
  const hasComparableSupport = visibleClaims.some((item) => item.stance === "SUPPORTS" &&
    new Set((item.evidence_refs || []).map((ref) => ref.paper_id)).size >= 2);
  const emptyMessage = {
    SUPPORTS: "在本次所选论文的已提取结果中，没有形成可直接核验的支持命题。请打开“证据不足”查看缺失环节。",
    REFUTES: hasComparableSupport
      ? "这组论文对当前命题给出方向一致的结果，未观察到相反结果。结论仅限所选论文和各自研究条件，不代表整个领域不存在争议。"
      : "本次所选论文没有提供同一对象、条件和指标下可直接比较的相反结果；因此不能判为“结果不一致”，也不能据此证明领域内没有冲突。",
    INSUFFICIENT: "本次列出的命题均有可定位的结果依据；仍需核对原文与研究条件。",
  };
  return <div><div className="evidenceMapIntro"><strong>Claim–Evidence Map</strong><span>点击命题查看论文、原文位置与证据边界</span></div>
    {!!visibleClaims.length && !hasDirectRelation && <div className="evidenceGuidance" role="note"><strong>这组材料尚不能判断支持或冲突</strong><p>当前论文片段未建立可直接比较的共同命题。“证据不足”表示缺少判断所需的结果，并不表示研究没有被检索到，更不能证明它不存在。可打开命题详情查看缺口。</p>{onReviseSelection && <button type="button" onClick={onReviseSelection}>更换论文并重新综合 →</button>}</div>}
    {!visibleClaims.length && <div className="evidenceEmpty"><span>证据地图尚未建立</span><h3>这次综合分析没有生成可定位的具体命题</h3><p>现有结果不能判断论文之间是否相互支持或冲突。可先查看对比矩阵，再补充可解析的全文重新分析。</p>{onReviseSelection && <button type="button" className="quietButton" onClick={onReviseSelection}>更换论文并重新综合 →</button>}<div><b>{papers.length}</b><small>篇参与综合的论文</small><b>0</b><small>条可核验命题</small></div></div>}
    {!!visibleClaims.length && <p className="miniNotice">分类只依据本次所选论文中可定位的结果片段；空栏说明这组材料没有形成该类证据，不等于对整个领域作出“存在”或“不存在”的结论。</p>}
    {!!visibleClaims.length &&
    <div className="evidenceColumns">{columns.map(([key, label, subtitle]) => <section key={key} className={`evidenceLane ${key.toLowerCase()}`}><header><h3>{label}</h3><small>{subtitle}</small><b>{visibleClaims.filter((item) => item.stance === key).length}</b></header>
      <div>{visibleClaims.filter((item) => item.stance === key).map((item, index) => <button key={index} className="evidenceNode" onClick={() => setSelected(item)}><strong>{item.claim}</strong><span>{item.paper_ids.map(title).join(" · ")}</span></button>)}
      {!visibleClaims.some((item) => item.stance === key) && <p className="emptyLane">{emptyMessage[key as keyof typeof emptyMessage]}</p>}</div></section>)}</div>}
    {selected && <EvidenceDrawer title={selected.claim} eyebrow="证据关系" onClose={() => setSelected(null)}><p>{selected.reason}</p><dl><dt>状态</dt><dd>{columns.find((row) => row[0] === selected.stance)?.[1]}</dd><dt>涉及论文</dt><dd>{selected.paper_ids.map(title).join("；")}</dd></dl>
      {selected.evidence_refs?.length ? selected.evidence_refs.map((ref, index) => <div className="evidenceCitation" key={index}><strong>{title(ref.paper_id)}</strong><small>{ref.section} · PDF {ref.page || "?"} 页</small><p>原文片段：{ref.snippet}</p><Link href={`/read?paper=${ref.paper_id}${ref.page ? `&page=${ref.page}` : ""}`}>查看原文 ↗</Link></div>) : <p className="miniNotice">未定位到具体原文位置；当前为 AI 对已提供论文片段的解释，需核对原文。</p>}
    </EvidenceDrawer>}
  </div>;
}
