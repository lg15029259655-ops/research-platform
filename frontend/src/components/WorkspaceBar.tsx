"use client";

import Link from "next/link";
import { useWorkspace } from "@/lib/workspace";

const steps = [
  { path: "/discover", label: "发现", next: "/read", nextLabel: "进入全文精读", note: "找到论文后取得 PDF" },
  { path: "/read", label: "精读", next: "/synthesis", nextLabel: "进入文献综合", note: "综合需要至少两篇全文" },
  { path: "/synthesis", label: "综合", next: "/design", nextLabel: "形成研究设计", note: "从证据中提炼问题" },
  { path: "/design", label: "设计", next: "/discover", nextLabel: "继续寻找证据", note: "回到文献核验想法" },
];

export default function WorkspaceBar({ current }: { current: string }) {
  const { workspace } = useWorkspace();
  const index = Math.max(0, steps.findIndex((step) => step.path === current));
  const step = steps[index];
  return <div className="workspaceStrip" aria-label="当前研究工作区">
    <div className="workspaceStage"><span>RESEARCH WORKSPACE</span><strong>{String(index + 1).padStart(2, "0")} <i>/ 04</i></strong></div>
    <div className="workspaceSummary"><small>{current === "/design" ? "发现页检索主题" : "当前主题"}</small><strong title={workspace?.query || "尚未设置研究主题"}>{workspace?.query || "尚未设置研究主题"}</strong><span>{workspace?.selected_paper_ids.length || 0} 篇待综合</span></div>
    <Link className="workspaceNext" href={step.next}><small>{step.note}</small><strong>{step.nextLabel} <span aria-hidden="true">↗</span></strong></Link>
  </div>;
}
