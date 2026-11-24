"use client";

import { categoryById, specificMethodCategory } from "@/lib/experiment-categories";
import ExperimentIcon from "@/components/experiment/ExperimentIcon";
import type { CSSProperties } from "react";
import "./paper-experiments.css";

/** 实验卡的强调色：按实验顺序循环取色，同一张图里形成节奏而不是一整片蓝。 */
const CARD_ACCENTS = ["#0A5AC2", "#0E7C86", "#7A5AF8", "#B26A00", "#2F80ED", "#5B7089"];

export type PaperExperimentEvidence = { unit_id: string; page: number | null; page_end?: number | null; snippet: string };

export type PaperExperiment = {
  id: string;
  order: number;
  title: string;
  category: string;
  methods: string[];
  result: string;
  evidence: PaperExperimentEvidence[];
  depends_on: string[];
  inferred: boolean;
};

export type PaperExperimentsPayload = {
  paper_id: string;
  parse_revision: number | string;
  summary: string;
  experiments: PaperExperiment[];
  generated_by: "ai" | "rules" | string;
  cited_evidence?: { title: string; page: number; description: string }[];
};

/**
 * 论文实验导图：论文"实际做过"的实验链（方法 → 证据 → 结果）。
 *
 * 与设计页的"实验设计图"不同：这里只呈现论文里出现过的实验，
 * 每个实验挂真实阅读单元的页码，点击即可回到 PDF 核对。
 */
export default function PaperExperimentsPanel({ payload, pending, onJump, onPage }: {
  payload: PaperExperimentsPayload | null;
  pending: boolean;
  onJump: (unitId: string) => void;
  onPage: (page: number) => void;
}) {
  if (pending && !payload) {
    return (
      <section className="pe-panel" aria-label="论文实验导图">
        <div className="pe-state" role="status">
          <strong>正在从方法与结果中提取实验…</strong>
          <p>正在整理可定位的原文线索，结果和实验的对应关系仍需核对。</p>
        </div>
      </section>
    );
  }

  const cited = payload?.cited_evidence;
  if (cited?.length) {
    return <section className="pe-panel" aria-label="论文实验导图">
      <header className="pe-head"><div>
        <span className="pe-kicker">PAPER EXPERIMENTS</span>
        <h2>论文实验导图</h2>
        <p className="pe-summary">综述引用的实验线索。页码指向综述原文。</p>
      </div><div className="pe-meta"><strong>{cited.length}</strong><span>项引用实验</span></div></header>
      <ol className="pe-flow">{cited.map((item, index) => (
        <li className="pe-step" key={item.title} style={{ "--pe-accent": CARD_ACCENTS[index % CARD_ACCENTS.length] } as CSSProperties}>
          <div className="pe-rail" aria-hidden="true"><span className="pe-order">{String(index + 1).padStart(2, "0")}</span></div>
          <article className="pe-card">
            <div className="pe-titleBlock"><h3>{item.title}</h3></div>
            <p className="pe-result">{item.description}</p>
            <button type="button" className="pe-page" onClick={() => onPage(item.page)}>p.{item.page}</button>
          </article>
        </li>
      ))}</ol>
    </section>;
  }

  if (!payload || !payload.experiments.length) {
    return (
      <section className="pe-panel" aria-label="论文实验导图">
        <div className="pe-state">
          <strong>尚未提取到实验</strong>
          <p>当前可用片段中未能识别实验，请核对原文或改善 PDF 解析。</p>
        </div>
      </section>
    );
  }

  const experiments = [...payload.experiments].sort((a, b) => a.order - b.order);

  return (
    <section className="pe-panel" aria-label="论文实验导图">
      <header className="pe-head">
        <div>
          <span className="pe-kicker">PAPER EXPERIMENTS</span>
          <h2>论文实验导图</h2>
          <p className="pe-summary">{payload.summary}</p>
        </div>
        <div className="pe-meta">
          <strong>{experiments.length}</strong>
          <span>项候选实验</span>
        </div>
      </header>

      {["rules", "ai_and_rules"].includes(payload.generated_by) && (
        <p className="pe-notice" role="note">
          当前为规则提取（未完成模型解读）：部分候选实验由原文关键词匹配，可能遗漏或误配，请逐项对照原文。
        </p>
      )}

      <ol className="pe-flow">
        {experiments.map((item, index) => {
          const meta = categoryById(item.category);
          const accent = CARD_ACCENTS[index % CARD_ACCENTS.length];
          return (
            <li
              className={`pe-step${item.inferred ? " is-inferred" : ""}`}
              key={item.id}
              style={{ "--pe-accent": accent } as CSSProperties}
            >
              <div className="pe-rail" aria-hidden="true">
                <span className="pe-order">{String(item.order).padStart(2, "0")}</span>

              </div>
              <article className="pe-card">
                <div className="pe-card-head">
                  <span className="pe-icon"><ExperimentIcon category={specificMethodCategory(item.title) || item.category} size={38} /></span>
                  <div className="pe-titleBlock">
                    <span className="pe-category">{meta?.name || "实验"}</span>
                    <h3>{item.title}</h3>
                  </div>
                  {item.inferred && <span className="pe-badge">待核对</span>}
                </div>

                {item.methods.length > 0 && (
                  <div className="pe-methods">{item.methods.map((method) => <span key={method}>{method}</span>)}</div>
                )}

                {item.result && <p className="pe-result"><b>结果</b>{item.result}</p>}

                {item.evidence.length > 0 && (
                  <div className="pe-evidence">
                    <span className="pe-evidenceLabel">证据</span>
                    {item.evidence.map((ref) => (
                      <button
                        key={`${ref.unit_id}:${ref.snippet}`}
                        type="button"
                        className="pe-page"
                        title={ref.snippet ? `章节起始页；线索：${ref.snippet}` : "回到章节起始页核对"}
                        onClick={() => onJump(ref.unit_id)}
                      >
                        {ref.page ? `p.${ref.page}${ref.page_end && ref.page_end > ref.page ? " 起" : ""}` : "原文"}
                      </button>
                    ))}
                  </div>
                )}

                {item.depends_on.length > 0 && (
                  <p className="pe-depends">依赖：{item.depends_on.join("、")}</p>
                )}
              </article>
            </li>
          );
        })}
      </ol>

      <p className="pe-footnote">
        候选实验和结果对应关系需要逐项核对原文；排列顺序不代表实际依赖关系。
      </p>
    </section>
  );
}
