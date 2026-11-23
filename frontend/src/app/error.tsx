"use client";

import { usePathname } from "next/navigation";
import PageMain from "@/components/PageMain";

export default function RouteError({ reset }: { reset: () => void }) {
  const path = usePathname();
  return <PageMain route={`${path}:error`} className="researchPage routeLoading">
    <section className="sectionBox" role="alert">
      <h1>这个页面暂时无法打开</h1>
      <p>可以重试当前页面。刷新后，仍可从当前标签页读取已保存的草稿。</p>
      <div className="actionRow">
        <button type="button" className="primaryButton" onClick={reset}>重试页面</button>
        <button type="button" onClick={() => window.location.reload()}>刷新页面</button>
      </div>
    </section>
  </PageMain>;
}
