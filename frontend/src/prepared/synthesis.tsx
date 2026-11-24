"use client";

import { useLayoutEffect, useState } from "react";
import Link from "next/link";
import PageMain from "@/components/PageMain";
import EvidenceMap, { type Claim } from "@/components/EvidenceMap";
import GapPath from "@/components/GapPath";
import { tabGroup } from "@/lib/tabs";
import data from "./synthesis.json";
import "./prepared.css";

const views = ["matrix", "evidence", "gaps"] as const;
type View = (typeof views)[number];

export default function PreparedSynthesis() {
  const [view, setView] = useState<View>("matrix");
  const [selectedClaim, setSelectedClaim] = useState<number | null>(null);
  useLayoutEffect(() => {
    const current = new URLSearchParams(window.location.search).get("view");
    if (current === "evidence" || current === "gaps") setView(current);
  }, []);
  const tabs = tabGroup(views, view, (next) => {
    setView(next);
    window.history.replaceState(null, "", `/synthesis?view=${next}`);
  });

  return <PageMain route="/synthesis" className="researchPage">
    <div className="pageIntro"><h1>文献综合</h1><p>三篇原文的研究问题、方法和证据对照</p></div>
    <div className="tabBar preparedTabs" {...tabs.list} aria-label="综合视图">
      <button {...tabs.item("matrix")}>对比矩阵</button><button {...tabs.item("evidence")}>证据地图</button><button {...tabs.item("gaps")}>研究空白</button>
    </div>
    <div className="synthesisResult">
      {view === "matrix" && <>
        {data.dimensions.map((dimension) => <section key={dimension.name} className="sectionBox preparedMatrix">
          <h2>{dimension.name}</h2><div>{dimension.values.map((cell) => <article key={cell.paper_id}>
            <h3><Link className="inlineLink" href={`/read?paper=${encodeURIComponent(cell.paper_id)}`}>{data.papers.find((paper) => paper.paper_id === cell.paper_id)?.title}</Link></h3>
            <p>{cell.value}</p>{cell.source && <small>{cell.source}</small>}
          </article>)}</div>
        </section>)}
        {!!data.consensus.length && <section className="sectionBox"><h2>共识</h2><ul>{data.consensus.map((item) => <li key={item}>{item}</li>)}</ul></section>}
        {!!data.differences.length && <section className="sectionBox"><h2>差异</h2><ul>{data.differences.map((item) => <li key={item}>{item}</li>)}</ul></section>}
      </>}
      {view === "evidence" && <EvidenceMap claims={data.controversies as Claim[]} papers={data.papers}
        selectedIndex={selectedClaim ?? -1} onSelect={setSelectedClaim} onOpenSource={() => {}} />}
      {view === "gaps" && <><GapPath data={data} handoffPending={false} />
        <Link className="quietButton" href="/design">查看已准备的科研设计 ↗</Link></>}
    </div>
  </PageMain>;
}
