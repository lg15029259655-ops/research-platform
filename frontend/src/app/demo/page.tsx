"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageMain from "@/components/PageMain";
import { readPaperLibrary, type PaperSummary } from "@/lib/paper-library";
import { useWorkspace } from "@/lib/workspace";

export default function Demo() {
  const { workspace, workspaceError, refresh } = useWorkspace();
  const [papers, setPapers] = useState<PaperSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void readPaperLibrary(controller.signal).then(setPapers).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [attempt]);

  const selected = workspace?.selected_paper_ids.flatMap((id) => papers?.find((paper) => paper.id === id) ?? []) ?? [];
  const ready = selected.length === 3 && workspace?.novelty_id && workspace.design_version_id && workspace.synthesis_id;

  return <PageMain route="/demo" className="researchPage">
    <h1>MedRead 演示</h1>
    {(failed || workspaceError) ? <p role="alert" className="researchError">暂时无法读取演示成果。 <button className="quietButton" onClick={() => {
      setFailed(false);
      setAttempt((count) => count + 1);
      void refresh(true).catch(() => {});
    }}>重试</button></p> : !papers || !workspace
      ? <p role="status" className="workspaceLoading">正在打开演示…</p>
      : ready ? <>
        <section className="sectionBox">
          <h2>已保存的研究成果</h2>
          <div className="actionRow">
            <Link className="quietButton" href="/design?view=novelty">新颖性扫描</Link>
            <Link className="quietButton" href="/design?view=canvas">设计沙盘</Link>
            <Link className="quietButton" href="/synthesis">文献综合</Link>
          </div>
        </section>
        <section className="sectionBox">
          <h2>三篇论文的全文解读</h2>
          <p>点开论文即可查看全文解读，页内可切换原文、行文导图和实验导图。</p>
          <ol>{selected.map((paper) => <li key={paper.id}>
            <Link className="inlineLink" href={`/read?paper=${encodeURIComponent(paper.id)}`}>{paper.title}</Link>
          </li>)}</ol>
        </section>
      </> : <p>当前工作区没有完整的演示成果。</p>}
  </PageMain>;
}
