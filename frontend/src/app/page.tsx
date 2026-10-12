"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API } from "@/lib/api";
import "./home-studio.css";

type Health = { status: string; database: string };

const modules = [
  { number: "01", href: "/discover", label: "文献发现", title: "找到值得读的论文", detail: "从研究问题出发，沿相似研究与引用关系追踪线索。", action: "探索文献" },
  { number: "02", href: "/read", label: "全文精读", title: "回到原文，看清证据", detail: "并排阅读 PDF 与讲解，逐段核对方法、结果和 Figure。", action: "开始精读" },
  { number: "03", href: "/synthesis", label: "文献综合", title: "把多篇研究放在一起", detail: "对照研究设计与结论，辨认共识、分歧和证据缺口。", action: "比较论文" },
  { number: "04", href: "/design", label: "科研设计", title: "把问题推进到方案", detail: "整理研究路径，调整节点，并保留每一次设计版本。", action: "设计研究" },
];

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    fetch(`${API}/api/health`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);
  const connected = health?.status === "ok" && health.database === "ok";

  return <main className="home-page"><div className="home-container">
    <header className="home-header">
      <Link href="/" className="home-brand" aria-label="MedRead 首页"><span className="home-brand-symbol" aria-hidden="true"><span /><span /><span /></span><span className="home-brand-name">MedRead<small>科研工作台</small></span></Link>
      <nav className="home-nav" aria-label="主要功能"><Link href="/discover">发现</Link><Link href="/read">精读</Link><Link href="/synthesis">综合</Link><Link href="/design">设计</Link></nav>
      <Link className="home-header-action" href="/read">进入工作台 <span aria-hidden="true">↗</span></Link>
    </header>
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-hero-main">
        <span className="home-kicker"><span className="home-kicker-line" />给每一步研究一个依据</span>
        <h1 id="home-title">读懂证据，<br /><em>再提出下一步问题。</em></h1>
        <p>从发现论文到设计研究，在同一个工作台整理线索、精读全文、比较结果。始终分清哪些结论来自摘要，哪些有全文支持。</p>
        <div className="home-hero-actions"><Link className="home-button home-button-primary" href="/read">开始精读 <span aria-hidden="true">↗</span></Link><Link className="home-button home-button-secondary" href="/discover">发现论文 <span aria-hidden="true">→</span></Link></div>
        <div className="home-health" role="status"><span className={connected ? "home-health-dot ready" : "home-health-dot"} />{connected ? "服务运行正常" : "正在检查服务状态"}<span className="home-health-separator" />文献、笔记与研究思路集中管理</div>
      </div>
      <aside className="home-route" aria-label="研究路径">
        <div className="home-route-heading"><span>WORKFLOW</span><span>01 — 04</span></div>
        <p className="home-route-title">一条可以回溯的<br />研究路径<span className="home-route-period">.</span></p>
        <ol><li><span>01</span><strong>发现问题</strong><small>定位关键论文</small></li><li><span>02</span><strong>核对证据</strong><small>阅读原文与图表</small></li><li><span>03</span><strong>比较研究</strong><small>辨认一致与分歧</small></li><li><span>04</span><strong>设计下一步</strong><small>形成可调整的方案</small></li></ol>
        <div className="home-route-foot">从论文出发，回到论文核实。</div>
      </aside>
    </section>
    <section className="home-modules" aria-labelledby="home-modules-title">
      <div className="home-section-heading"><div><span>YOUR WORKSPACE</span><h2 id="home-modules-title">选择今天要做的事</h2></div><p>四个入口，贯穿一项研究的完整过程。</p></div>
      <div className="home-module-grid">{modules.map((module) => <Link className="home-module" href={module.href} key={module.number}>
        <div className="home-module-top"><span className="home-module-number">{module.number}</span><span className="home-module-label">{module.label}</span><span className="home-module-arrow" aria-hidden="true">↗</span></div>
        <div className="home-module-content"><h3>{module.title}</h3><p>{module.detail}</p></div>
        <div className="home-module-bottom"><span>{module.action}</span><span aria-hidden="true">→</span></div>
      </Link>)}</div>
    </section>
    <footer className="home-footer"><span>MedRead / 科研工作台</span><span>让研究过程有迹可循</span></footer>
  </div></main>;
}
