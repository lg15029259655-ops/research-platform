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

export default function EvidenceMap({ claims, papers }: { claims: Claim[]; papers: Paper[] }) {
  const [selected, setSelected] = useState<Claim | null>(null);
  const visibleClaims = claims;
  const title = (id: string) => papers.find((item) => item.paper_id === id)?.title || "未知论文";
  return <div><div className="evidenceMapIntro"><strong>Claim–Evidence Map</strong><span>点击命题查看论文、原文位置与证据边界</span></div>
    {!visibleClaims.length && <div className="evidenceEmpty"><span>证据地图尚未建立</span><h3>这次综合分析没有生成可定位的具体命题</h3><p>现有结果不能判断论文之间是否相互支持或冲突。可先查看对比矩阵，再补充可解析的全文重新分析。</p><div><b>{papers.length}</b><small>篇参与综合的论文</small><b>0</b><small>条可核验命题</small></div></div>}
    {!!visibleClaims.length &&
    <div className="evidenceColumns">{columns.map(([key, label, subtitle]) => <section key={key} className={`evidenceLane ${key.toLowerCase()}`}><header><h3>{label}</h3><small>{subtitle}</small><b>{visibleClaims.filter((item) => item.stance === key).length}</b></header>
      <div>{visibleClaims.filter((item) => item.stance === key).map((item, index) => <button key={index} className="evidenceNode" onClick={() => setSelected(item)}><strong>{item.claim}</strong><span>{item.paper_ids.map(title).join(" · ")}</span></button>)}
      {!visibleClaims.some((item) => item.stance === key) && <p className="emptyLane">暂无归入此类的命题</p>}</div></section>)}</div>}
    {selected && <EvidenceDrawer title={selected.claim} eyebrow="证据关系" onClose={() => setSelected(null)}><p>{selected.reason}</p><dl><dt>状态</dt><dd>{columns.find((row) => row[0] === selected.stance)?.[1]}</dd><dt>涉及论文</dt><dd>{selected.paper_ids.map(title).join("；")}</dd></dl>
      {selected.evidence_refs?.length ? selected.evidence_refs.map((ref, index) => <div className="evidenceCitation" key={index}><strong>{title(ref.paper_id)}</strong><small>{ref.section} · PDF {ref.page || "?"} 页</small><p>原文片段：{ref.snippet}</p><Link href={`/read?paper=${ref.paper_id}${ref.page ? `&page=${ref.page}` : ""}`}>查看原文 ↗</Link></div>) : <p className="miniNotice">未定位到具体原文位置；当前为 AI 对已提供论文片段的解释，需核对原文。</p>}
    </EvidenceDrawer>}
  </div>;
}
