"use client";

import { useLayoutEffect, useState } from "react";
import Link from "next/link";
import PageMain from "@/components/PageMain";
import DesignFlow from "@/components/DesignFlow";
import { deferredPanel } from "@/components/deferred-panel";
import { tabGroup } from "@/lib/tabs";
import prepared from "./design.json";
import "./prepared.css";

const NoveltySpace = deferredPanel(() => import("@/components/NoveltySpace"), "相似研究星系");
const views = ["novelty", "canvas"] as const;
type View = (typeof views)[number];

export default function PreparedDesign() {
  const { novelty, design } = prepared;
  const [view, setView] = useState<View>("canvas");
  useLayoutEffect(() => {
    const current = new URLSearchParams(window.location.search).get("view");
    if (current === "novelty") setView(current);
  }, []);

  const tabs = tabGroup(views, view, (next) => {
    setView(next);
    window.history.replaceState(null, "", `/design?view=${next}`);
  });

  return <PageMain route="/design" className="researchPage">
    <div className="pageIntro"><h1>科研设计</h1><p>{design.goal}</p></div>
    <div className="tabBar preparedTabs" {...tabs.list} aria-label="科研设计内容">
      <button {...tabs.item("novelty")}>新颖性扫描</button><button {...tabs.item("canvas")}>设计沙盘</button>
    </div>
    {view === "canvas" ? <>
      <section className="sectionBox"><h2>设计思路</h2><p>{design.change_summary}</p>
        <Link className="inlineLink" href="/synthesis?view=gaps">查看文献综合依据 ↗</Link>
      </section>
      <DesignFlow design={design} artifactId="prepared-design" readOnly />
      <section className="sectionBox">
        {([["对照", design.controls], ["检测指标", design.readouts], ["假设与限制", design.assumptions]] as const).map(([label, list]) =>
          <div key={label}><h3>{label}</h3><ul>{list.map((item) => <li key={item}>{item}</li>)}</ul></div>)}
      </section>
    </> : <section className="sectionBox"><h2>新颖性扫描</h2><p>{novelty.evidence_scope}</p>
      <p>整体相似程度：{novelty.similarity_level}</p>
      <ul>{novelty.similar_papers.map((paper) => <li key={paper.openalex_id}>
        <a className="inlineLink" href={`https://openalex.org/${encodeURIComponent(paper.openalex_id)}`} target="_blank" rel="noopener noreferrer">{paper.title}</a>
      </li>)}</ul>
      <NoveltySpace novelty={novelty} busy={false} onView={(paper) => window.open(`https://openalex.org/${encodeURIComponent(paper.openalex_id)}`, "_blank", "noopener,noreferrer")} />
    </section>}
  </PageMain>;
}
