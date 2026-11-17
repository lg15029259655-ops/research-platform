"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { API } from "@/lib/api";
import { useFocusTrap } from "@/lib/useFocusTrap";
import "./home-studio.css";

type Health = { status: string; database: string };
const COMPETITION_URL = "https://agent.xjtu.edu.cn/aiic/index.htm";

const modules = [
  { number: "01", href: "/discover", label: "文献发现", title: "找到值得读的论文", detail: "从研究问题出发，沿相似研究与引用关系追踪线索。", action: "探索文献" },
  { number: "02", href: "/read", label: "全文精读", title: "回到原文，看清证据", detail: "并排阅读 PDF 与讲解，逐段核对方法、结果和 Figure。", action: "开始精读" },
  { number: "03", href: "/synthesis", label: "文献综合", title: "把多篇研究放在一起", detail: "对照研究设计与结论，辨认共识、分歧和证据缺口。", action: "比较论文" },
  { number: "04", href: "/design", label: "科研设计", title: "把问题推进到方案", detail: "整理研究路径，调整节点，并保留每一次设计版本。", action: "设计研究" },
];

// 研究路径 01–04：来自原 home-route 的 ol（从 Hero 右栏提升为独立分区）
const workflow = [
  { number: "01", title: "发现问题", detail: "定位关键论文" },
  { number: "02", title: "核对证据", detail: "阅读原文与图表" },
  { number: "03", title: "比较研究", detail: "辨认一致与分歧" },
  { number: "04", title: "设计下一步", detail: "形成可调整的方案" },
];

// 真实事实条：只允许出现 4 与 2–5 两个数字，其余为纯文案（design-spec §3.1 分区 3）
type Fact = { value: string; unit: string } | { text: string };
const facts: Fact[] = [
  { value: "4", unit: "个研究模块" },          // 依据：app/page.tsx 的 modules[] 长度 = 4
  { value: "2–5", unit: "篇全文同屏对照" },     // 依据：synthesis/page.tsx selected.length<5 上限、compare() 要求 ≥2
  { text: "研究记录与上传的 PDF 保存在服务端" },
  { text: "匿名会话，无需注册" },               // 依据：read/page.tsx initialize() 调 GET /api/session
  { text: "检索来自 OpenAlex" },                // 依据：discover/page.tsx 页首文案「自然语言检索 OpenAlex」
];

// 真实 FAQ：文案逐字取自 design-spec §3.1 分区 6，只陈述代码里确实存在的行为
const faq = [
  { id: "storage", question: "我的文件和 PDF 保存在哪里？", answer: "上传的 PDF 和研究记录保存在运行本网站的服务器上；如果你在自己的电脑上运行本站，则保存在那台电脑上。" },
  { id: "account", question: "需要注册或登录吗？", answer: "不需要。系统建立匿名会话（GET /api/session）后即可使用。" },
  { id: "hallucination", question: "AI 会编造内容吗？", answer: "AI 基于已提供的文本/摘要生成，可能不准确，页面多处提示「请与原文核对」；检索阶段的相似度判断只依据摘要，未完成全文核验。" },
  { id: "search-mode", question: "和普通关键词搜索有什么区别？", answer: "提供「语义检索」与「关键词检索」两种模式：语义检索适合用研究问题提问，关键词检索适合精确题名。" },
  { id: "upload", question: "必须先上传 PDF 吗？", answer: "检索与关系图谱无需 PDF；但逐页精读、行文导图、实验导图和多篇综合需要先取得或上传全文 PDF。" },
  { id: "verify", question: "AI 讲解能核对到原文吗？", answer: "精读按「阅读单元」推进，可回到 PDF 页码；当标注「未定位到具体原文位置」时，不能当作已核验的全文事实。" },
];

/** 项目说明弹窗：独立组件，仅在 showIntro 为真时挂载，焦点陷阱才会在挂载时建立（D3 修复）。 */
function IntroDialog({ onClose }: { onClose: () => void }) {
  const rootRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useFocusTrap(rootRef, closeRef);
  return <div className="home-intro-backdrop">
    <section ref={rootRef} className="home-intro-dialog" role="dialog" aria-modal="true" aria-labelledby="home-intro-title" aria-describedby="home-intro-description" tabIndex={-1}>
      <span className="home-intro-eyebrow">PROJECT NOTE / 项目说明</span>
      <h2 id="home-intro-title">电信T.A杯 · 参赛作品展示</h2>
      <p className="home-intro-competition">西安交通大学《电信T.A杯》“AI+教育”创新应用技能大赛</p>
      <p id="home-intro-description">MedRead 是为本次大赛准备的作品展示页面，演示文献发现、PDF 精读、跨论文比较与研究设计。AI 生成内容可能不准确，请以论文原文核对；本站并非赛事或学校官方网站，也不提供医疗诊断建议。</p>
      <div className="home-intro-links">
        <a href={COMPETITION_URL} target="_blank" rel="noopener noreferrer">查看赛事官网 ↗</a>
        <Link href="/read">跳过介绍，直接进入工作台 →</Link>
      </div>
      {/* data-autofocus 供 useFocusTrap 定位初始焦点（优先于首个可聚焦元素） */}
      <button type="button" onClick={onClose} data-autofocus>了解，进入网站 <span aria-hidden="true">→</span></button>
      <small>确认后，此浏览器将不再自动显示本说明。</small>
    </section>
  </div>;
}

export default function Home() {
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [term, setTerm] = useState("");
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  useEffect(() => {
    try { setShowIntro(window.localStorage.getItem("medread-intro-acknowledged-v4") !== "1"); } catch { setShowIntro(true); }
    fetch(`${API}/api/health`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);
  const connected = health?.status === "ok" && health.database === "ok";

  function dismissIntro() {
    try { window.localStorage.setItem("medread-intro-acknowledged-v4", "1"); } catch { /* Storage may be unavailable. */ }
    setShowIntro(false);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const q = term.trim();
    if (!q) return;                                   // 空串不跳转
    router.push(`/discover?q=${encodeURIComponent(q)}`);
  }

  return <main className="home-page" id="main">
    {showIntro && <IntroDialog onClose={dismissIntro} />}
    <div className="home-container">
      {/* 分区 1 · header（brand chrome） */}
      <header className="home-header">
        <Link href="/" className="home-brand" aria-label="MedRead 首页">
          <span className="home-brand-mark" aria-hidden="true">✳</span>
          <span className="home-brand-name">MedRead<small>科研工作台</small></span>
        </Link>
        <nav className="home-nav" aria-label="主要功能"><Link href="/discover">发现</Link><Link href="/read">精读</Link><Link href="/synthesis">综合</Link><Link href="/design">设计</Link></nav>
        <Link className="home-header-action" href="/read">进入工作台 <span aria-hidden="true">↗</span></Link>
      </header>

      {/* 分区 2 · Hero */}
      <section className="home-hero" aria-labelledby="home-title">
        <h1 id="home-title">读懂证据，<br /><em>再提出下一步问题。</em></h1>
        <p>从发现论文到设计研究，在同一个工作台整理线索、精读全文、比较结果。始终分清哪些结论来自摘要，哪些有全文支持。</p>
        <div className="home-hero-actions">
          <Link className="home-button home-button-primary" href="/discover">开始检索 <span aria-hidden="true">↗</span></Link>
          <a className="home-button home-button-secondary" href="#workflow">了解工作流 <span aria-hidden="true">→</span></a>
        </div>
        <form className="home-search" role="search" onSubmit={submitSearch}>
          <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="用一句话描述你的研究问题…" aria-label="检索文献：用一句话描述你的研究问题" />
          <button type="submit" aria-label="开始检索">→</button>
        </form>
        <div className="home-health" role="status"><span className={connected ? "home-health-dot ready" : "home-health-dot"} />{connected ? "服务运行正常" : "正在检查服务状态"}<span className="home-health-separator" />文献、笔记与研究思路集中管理</div>
      </section>

      {/* 分区 3 · 真实事实条 */}
      <section className="home-facts" aria-label="产品事实">
        {facts.map((fact, index) => <div className="home-fact" key={index}>
          {"value" in fact
            ? <><b className="home-fact-value">{fact.value}</b><span className="home-fact-label">{fact.unit}</span></>
            : <span className="home-fact-text">{fact.text}</span>}
        </div>)}
      </section>

      {/* 分区 4 · 工作流 01–04 */}
      <section className="home-section home-workflow" id="workflow" aria-labelledby="home-workflow-title">
        <div className="home-section-head"><span className="home-eyebrow">WORKFLOW / 研究路径</span><h2 id="home-workflow-title">一条可以回溯的研究路径</h2></div>
        <ol className="home-workflow-list">
          {workflow.map((step) => <li key={step.number}><span className="home-step-number">{step.number}</span><strong>{step.title}</strong><small>{step.detail}</small></li>)}
        </ol>
        <p className="home-workflow-foot">从论文出发，回到论文核实。</p>
      </section>

      {/* 分区 5 · 四模块入口卡 */}
      <section className="home-section home-modules" aria-labelledby="home-modules-title">
        <div className="home-section-head"><span className="home-eyebrow">YOUR WORKSPACE / 工作区</span><h2 id="home-modules-title">四个模块，贯穿一项研究</h2><p>四个入口，覆盖从发现问题到设计方案的完整过程。</p></div>
        <div className="home-module-grid">{modules.map((module) => <Link className="home-module" href={module.href} key={module.number}>
          <div className="home-module-top"><span className="home-module-number">{module.number}</span><span className="home-module-label">{module.label}</span><span className="home-module-arrow" aria-hidden="true">↗</span></div>
          <div className="home-module-content"><h3>{module.title}</h3><p>{module.detail}</p></div>
          <div className="home-module-bottom"><span>{module.action}</span><span aria-hidden="true">→</span></div>
        </Link>)}</div>
      </section>

      {/* 分区 6 · 真实 FAQ（可键盘操作的手风琴） */}
      <section className="home-section home-faq" aria-labelledby="home-faq-title">
        <div className="home-section-head"><span className="home-eyebrow">FAQ / 常见问题</span><h2 id="home-faq-title">关于 MedRead，你可能想问</h2></div>
        <div className="home-faq-list">
          {faq.map((item) => <div className={`home-faq-item${openFaq === item.id ? " open" : ""}`} key={item.id}>
            <h3>
              <button type="button" id={`faq-btn-${item.id}`} aria-expanded={openFaq === item.id} aria-controls={`faq-panel-${item.id}`} onClick={() => setOpenFaq(openFaq === item.id ? null : item.id)}>
                <span>{item.question}</span>
                <span className="home-faq-plus" aria-hidden="true">+</span>
              </button>
            </h3>
            <div className="home-faq-panel" id={`faq-panel-${item.id}`} role="region" aria-labelledby={`faq-btn-${item.id}`}>
              <div className="home-faq-panel-inner"><p>{item.answer}</p></div>
            </div>
          </div>)}
        </div>
      </section>

      {/* 分区 7 · footer */}
      <footer className="home-footer"><span>MedRead / 科研工作台</span><span>让研究过程有迹可循</span></footer>
    </div>
  </main>;
}
