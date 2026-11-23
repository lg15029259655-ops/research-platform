"use client";

import Link from "next/link";
import { useState } from "react";
import EvidenceDrawer from "@/components/EvidenceDrawer";

type Ref = { paper_id: string; unit_id: string; section: string; page: number | null; page_start?: number | null; page_end?: number | null; snippet: string; quote_verified?: boolean; file_version?: string | null };
export type Claim = { claim: string; paper_ids: string[]; stance: "SUPPORTS" | "REFUTES" | "INSUFFICIENT";
  reason: string; evidence_refs?: Ref[] };
type Paper = { paper_id: string; title: string };
const columns = [["SUPPORTS", "支持", "现有证据支持"], ["REFUTES", "结果不一致", "存在相反或不一致的结果"],
  ["INSUFFICIENT", "证据不足", "当前资料不足以判断"]] as const;

function sourceLink(ref: Ref, stale: boolean) {
  const params = new URLSearchParams({ paper: ref.paper_id });
  const page = ref.page || ref.page_start;
  if (ref.file_version) params.set("source_file", ref.file_version);
  if (stale && !ref.file_version) {
    params.set("source_file", "unknown");
    return { href: `/read?${params}`, label: "打开当前 PDF 核对" };
  }
  if (page) params.set("page", String(page));
  const label = ref.page ? `打开原文第 ${ref.page} 页` : page ? `从第 ${page} 页开始核对` : "打开 PDF 核对";
  return { href: `/read?${params}`, label };
}

export default function EvidenceMap({ claims, papers, onReviseSelection, stale = false }: {
  claims: Claim[]; papers: Paper[]; onReviseSelection?: () => void; stale?: boolean;
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
  return <div><div className="evidenceMapIntro"><strong>文献证据关系</strong><span>共 {visibleClaims.length} 条命题</span></div>
    {!!visibleClaims.length && !hasDirectRelation && <div className="evidenceGuidance" role="note"><strong>这组材料尚不能判断支持或冲突</strong><p>当前论文片段未建立可直接比较的共同命题。“证据不足”表示缺少判断所需的结果，并不表示研究没有被检索到，更不能证明它不存在。可打开命题详情查看缺口。</p>{onReviseSelection && <button type="button" onClick={onReviseSelection}>更换论文并重新综合 →</button>}</div>}
    {!visibleClaims.length && <div className="evidenceEmpty"><span>证据地图尚未建立</span><h3>这次综合分析没有生成可定位的具体命题</h3><p>现有结果不能判断论文之间是否相互支持或冲突。可先查看对比矩阵，再补充可解析的全文重新分析。</p>{onReviseSelection && <button type="button" className="quietButton" onClick={onReviseSelection}>更换论文并重新综合 →</button>}<div><b>{papers.length}</b><small>篇参与综合的论文</small><b>0</b><small>条可核验命题</small></div></div>}
    {!!visibleClaims.length && <p className="miniNotice">分类由 AI 根据所选片段提出；原文引用匹配不等于已验证支持或冲突关系，请核对研究条件和上下文。空栏不代表整个领域没有相关证据。</p>}
    {!!visibleClaims.length &&
    <div className="evidenceColumns">{columns.map(([key, label, subtitle]) => <section key={key} className={`evidenceLane ${key.toLowerCase()}`}><header><h3>{label}</h3><small>{subtitle}</small><b>{visibleClaims.filter((item) => item.stance === key).length}</b></header>
      <div>{visibleClaims.filter((item) => item.stance === key).map((item, index) => <button key={index} className="evidenceNode" onClick={() => setSelected(item)}><strong>{item.claim}</strong><span>{item.paper_ids.map(title).join(" · ")}</span></button>)}
      {!visibleClaims.some((item) => item.stance === key) && <p className="emptyLane">{emptyMessage[key as keyof typeof emptyMessage]}</p>}</div></section>)}</div>}
    {selected && <EvidenceDrawer title={selected.claim} eyebrow="证据关系" onClose={() => setSelected(null)}><p>{selected.reason}</p><dl><dt>状态</dt><dd>{columns.find((row) => row[0] === selected.stance)?.[1]}</dd><dt>涉及论文</dt><dd>{selected.paper_ids.map(title).join("；")}</dd></dl>
      {selected.evidence_refs?.length ? selected.evidence_refs.map((ref, index) => {
        const { href, label } = sourceLink(ref, stale);
        return <div className="evidenceCitation" key={index}>
          <strong>{title(ref.paper_id)}</strong>
          <small>{ref.section} · {ref.page ? `PDF ${ref.page} 页` : ref.page_start && ref.page_end ? `PDF ${ref.page_start}–${ref.page_end} 页范围，具体页待核对` : "页码待核对"}</small>
          <p>{ref.quote_verified ? "匹配到的原文（支持关系仍需核对）" : "单元开头（未核对为该命题的依据）"}：{ref.snippet}</p>
          <Link href={href}>{label} ↗</Link>
        </div>;
      }) : <p className="miniNotice">未定位到具体原文位置；当前为 AI 对已提供论文片段的解释，需核对原文。</p>}
    </EvidenceDrawer>}
  </div>;
}
