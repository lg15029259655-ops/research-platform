"use client";

import { useLayoutEffect, useRef, useState } from "react";
import PageMain from "@/components/PageMain";
import { deferredPanel } from "@/components/deferred-panel";
import type { MindMapPayload } from "@/components/mindmap/MindMapPanel";
import PaperExperimentsPanel, { type PaperExperimentsPayload } from "@/components/experiment-map/PaperExperimentsPanel";
import { tabGroup } from "@/lib/tabs";
import papers from "./reader.json";
import "./prepared.css";

const PdfPane = deferredPanel(() => import("@/components/PdfPane"), "PDF");
const MindMapPanel = deferredPanel(() => import("@/components/mindmap/MindMapPanel"), "行文导图");
const views = ["summary", "pdf", "mindmap", "experiments"] as const;
type View = (typeof views)[number];
const reviewEvidence: Record<string, { title: string; description: string; page: number }[]> = {
  "/prepared-papers/35064256.pdf": [
    { title: "部分肝切除与再生", description: "综述引用了肝脏 α-catenin 敲低的研究。研究报告切除后 YAP 活化和肝细胞增殖增加。", page: 3 },
    { title: "肝星状细胞与纤维化", description: "综述引用的研究报告，维替泊芬处理后，培养肝星状细胞的 Acta2 与 Col1a1 上调受到抑制。", page: 10 },
  ],
  "/prepared-papers/42008043.pdf": [
    { title: "肺纤维化模型", description: "综述引用了博来霉素诱导的肺纤维化研究，报告持续的 YAP 活化与纤维化加重相关，并讨论了 YAP 与 TAZ 的不同作用。", page: 10 },
    { title: "巩膜成纤维细胞", description: "综述概述了 TGF-β2、YAP 与 SMAD2/3 参与的纤维化研究，并报告了 YAP 抑制剂对所述病理变化的影响。", page: 11 },
    { title: "皮肤纤维化干预", description: "综述引用了富马酸二甲酯在系统性硬化相关纤维化中的研究，讨论了 TAZ 与 YAP 信号。", page: 11 },
  ],
};

function locationSelection() {
  const params = new URLSearchParams(window.location.search);
  const paper = papers.find((item) => item.id === params.get("paper")) ?? papers[0];
  const page = Math.min(paper.page_count, Math.max(1, Math.trunc(Number(params.get("page"))) || 1));
  return { paper, page, view: (params.has("page") || params.has("citation") ? "pdf" : "summary") as View };
}

export default function PreparedReader() {
  const [paper, setPaper] = useState(papers[0]);
  const [view, setView] = useState<View>("summary");
  const [page, setPage] = useState(1);
  const restored = useRef(false);
  const tabs = tabGroup(views, view, setView);

  useLayoutEffect(() => {
    function restore() {
      const selected = locationSelection();
      setPaper(selected.paper);
      setPage(selected.page);
      setView(selected.view);
    }
    if (!restored.current) {
      restored.current = true;
      restore();
    }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function selectPaper(next: typeof paper) {
    if (next.id === paper.id) return;
    setPaper(next);
    setPage(1);
    setView("summary");
    window.history.pushState(null, "", `/read?paper=${encodeURIComponent(next.id)}`);
  }

  function openPage(next: number) {
    setPage(next);
    setView("pdf");
    window.history.replaceState(null, "", `/read?paper=${encodeURIComponent(paper.id)}&page=${next}`);
  }

  function jumpTo(unitId: string) {
    openPage(paper.units.find((unit) => unit.id === unitId)?.page ?? 1);
  }

  return <PageMain route="/read" className="researchPage preparedReader">
    <aside className="sectionBox preparedLibrary">
      <h2>论文库</h2>
      {papers.map((item) => <button type="button" key={item.id} aria-current={paper.id === item.id ? "true" : undefined}
        onClick={() => selectPaper(item)}>{item.title}</button>)}
    </aside>
    <div className="preparedContent">
      <div className="pageIntro"><h1>{paper.title}</h1></div>
      <div className="tabBar preparedTabs" {...tabs.list} aria-label="精读视图">
        <button {...tabs.item("summary")}>全文解读</button>
        <button {...tabs.item("pdf", () => { PdfPane.preload(); setView("pdf"); })}>原文 PDF</button>
        <button {...tabs.item("mindmap", () => { MindMapPanel.preload(); setView("mindmap"); })}>行文导图</button>
        <button {...tabs.item("experiments")}>实验导图</button>
      </div>
      {view === "summary" && <article className="sectionBox savedReading">
        <h2>全文解读</h2><p>{paper.summary.question}</p>
        {paper.summary.stages.map((stage) => <section key={stage.key}>
          <h3>{stage.label}</h3><p>{stage.summary}</p>
          {stage.unit_ids[0] && <button className="quietButton" type="button" onClick={() => jumpTo(stage.unit_ids[0])}>对照原文 ↗</button>}
        </section>)}
        <h3>局限与证据边界</h3><ul>{paper.summary.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </article>}
      {view === "pdf" && <section className="sectionBox preparedPdf">
        <PdfPane key={paper.id} paperId={paper.id} sourceUrl={paper.file} page={page} totalPages={paper.page_count} onPageChange={openPage} />
      </section>}
      {view === "mindmap" && <MindMapPanel key={paper.id} mindmap={paper.mindmap as MindMapPayload} pending={false} onJump={jumpTo} />}
      {view === "experiments" && (paper.experiments.experiments.length
        ? <PaperExperimentsPanel key={paper.id} payload={paper.experiments as PaperExperimentsPayload} pending={false} onJump={jumpTo} />
        : <section className="sectionBox"><h2>论文实验导图</h2>
          <p>以下线索来自综述引用的实验研究。页码指向综述原文。</p>
          <ol className="preparedEvidence">{reviewEvidence[paper.file]?.map((item) => <li key={item.title}>
            <h3>{item.title}</h3><p>{item.description}</p>
            <button type="button" className="quietButton" onClick={() => openPage(item.page)}>核对第 {item.page} 页 ↗</button>
          </li>)}</ol>
        </section>)}
    </div>
  </PageMain>;
}
