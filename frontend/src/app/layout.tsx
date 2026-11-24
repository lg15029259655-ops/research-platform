import type { Metadata } from "next";
import { Suspense } from "react";
import "./tokens.css";
import "./globals.css";
import "./research.css";
import "./studio.css";
import "./controls.css";
import ResearchShell from "@/components/ResearchShell";

export const metadata: Metadata = {
  title: "MedRead · 生物科学科研工作台",
  description: "文献发现、全文精读、文献综合与科研设计：让研究过程有迹可循。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>
    {/* 跳过导航直达主内容（ux-spec D13）；#main 由各页 <main> 承担 */}
    <a href="#main" className="skipLink">跳到主要内容</a>
    <ResearchShell>
      <Suspense fallback={<main id="main" className="researchPage routeLoading" tabIndex={-1} aria-busy="true">
        <p className="workspaceLoading" role="status">正在打开页面…</p>
      </main>}>{children}</Suspense>
    </ResearchShell>
  </body></html>;
}
