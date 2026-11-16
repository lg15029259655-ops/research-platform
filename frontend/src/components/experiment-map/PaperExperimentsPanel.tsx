"use client";

import { categoryById } from "@/lib/experiment-categories";
import ExperimentIcon from "@/components/experiment/ExperimentIcon";
import type { CSSProperties } from "react";
import "./paper-experiments.css";

/** 实验卡的强调色：按实验顺序循环取色，同一张图里形成节奏而不是一整片蓝。 */
const CARD_ACCENTS = ["#0A5AC2", "#0E7C86", "#7A5AF8", "#B26A00", "#2F80ED", "#5B7089"];

export type PaperExperimentEvidence = { unit_id: string; page: number | null; snippet: string };

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
};

/**
 * 论文实验导图：论文"实际做过"的实验链（方法 → 证据 → 结果）。
 *
 * 与设计页的"实验设计图"不同：这里只呈现论文里出现过的实验，
 * 每个实验挂真实阅读单元的页码，点击即可回到 PDF 核对。
 */
export default function PaperExperimentsPanel({ payload, pending, onJump }: {
  payload: PaperExperimentsPayload | null;
  pending: boolean;
  onJump: (unitId: string) => void;
}) {
  if (pending && !payload) {
    return (
      <section className="pe-panel" aria-label="论文实验导图">
        <div className="pe-state" role="status">
          <strong>正在从方法与结果中提取实验…</strong>
          <p>先定位方法章节的实验步骤，再把结果与图表对应到每个实验上。</p>
        </div>
      </section>
    );
  }

  if (!payload || !payload.experiments.length) {
    return (
      <section className="pe-panel" aria-label="论文实验导图">
        <div className="pe-state">
          <strong>尚未提取到实验</strong>
          <p>当前论文的解析片段里没有可识别的实验步骤；可先完成精读/重新识别后再生成。</p>
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
          <span>个实验</span>
        </div>
      </header>

      {payload.generated_by === "rules" && (
        <p className="pe-notice" role="note">
          当前为规则提取（未完成模型解读）：实验名称与页码来自原文关键词，可重试生成更细的版本。
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
                {index < experiments.length - 1 && <span className="pe-line" />}
              </div>
              <article className="pe-card">
                <div className="pe-card-head">
                  <span className="pe-icon"><ExperimentIcon category={item.category} size={38} /></span>
                  <div className="pe-titleBlock">
                    <span className="pe-category">{meta?.name || "实验"}</span>
                    <h3>{item.title}</h3>
                  </div>
                  {item.inferred && <span className="pe-badge">推断</span>}
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
                        key={ref.unit_id}
                        type="button"
                        className="pe-page"
                        title={ref.snippet || "回到 PDF 核对"}
                        onClick={() => onJump(ref.unit_id)}
                      >
                        {ref.page ? `p.${ref.page}` : "原文"}
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
        实验链由方法/结果片段整理，先后顺序与证据对应需回到原文核对；"推断"表示片段中缺少直接结果或证据。
      </p>
    </section>
  );
}
