"use client";

import { categoryById, specificMethodCategory } from "@/lib/experiment-categories";
import ExperimentIcon from "@/components/experiment/ExperimentIcon";
import type { CSSProperties } from "react";
import "./paper-experiments.css";

/** 实验卡的强调色：按实验顺序循环取色，同一张图里形成节奏而不是一整片蓝。 */
const CARD_ACCENTS = ["#0A5AC2", "#0E7C86", "#7A5AF8", "#B26A00", "#2F80ED", "#5B7089"];

export type PaperExperimentEvidence = { unit_id?: string; page: number | null; page_end?: number | null; snippet?: string };

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
  cited?: boolean;
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

  const legacyCited = payload?.cited_evidence ?? [];
  const cited = payload?.cited || legacyCited.length > 0;
  const cards = payload?.experiments.length ? payload.experiments : legacyCited.map((item, index): PaperExperiment => ({
    id: `quoted-${index}`, order: index + 1, title: item.title, category: "result_conclusion",
    methods: [], result: item.description, evidence: [{ page: item.page }], depends_on: [], inferred: false,
  }));
  if (!payload || !cards.length) {
    return (
      <section className="pe-panel" aria-label="论文实验导图">
        <div className="pe-state">
          <strong>尚未提取到实验</strong>
          <p>{cited ? "当前片段中没有可定位的引用实验线索。" : "当前片段中没有可定位的实验线索。可对照方法、结果和图注，或检查 PDF 是否识别完整。"}</p>
        </div>
      </section>
    );
  }

  const experiments = [...cards].sort((a, b) => a.order - b.order);

  return (
    <section className="pe-panel" aria-label="论文实验导图">
      <header className="pe-head">
        <div>
          <span className="pe-kicker">PAPER EXPERIMENTS</span>
          <h2>论文实验导图</h2>
          <p className="pe-summary">{legacyCited.length && !payload.experiments.length ? "综述引用的实验线索。页码指向综述原文。" : payload.summary}</p>
        </div>
        <div className="pe-meta">
          <strong>{experiments.length}</strong>
          <span>{cited ? "项引用实验" : payload.generated_by === "prepared" ? "项实验与分析" : "项候选实验"}</span>
        </div>
      </header>

      {!cited && ["rules", "ai_and_rules"].includes(payload.generated_by) && (
        <p className="pe-notice" role="note">
          含按原文线索提取的候选条目，请结合证据页核对实验与结果的对应关系。
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
                  <span className="pe-icon"><ExperimentIcon category={specificMethodCategory(item.title) || meta?.id || "result_conclusion"} size={38} /></span>
                  <div className="pe-titleBlock">
                    <span className="pe-category">{meta?.name || "实验"}</span>
                    <h3>{item.title}</h3>
                  </div>
                  {cited ? <span className="pe-badge">综述引用</span> : item.inferred && <span className="pe-badge">待核对</span>}
                </div>

                {item.methods.length > 0 && (
                  <div className="pe-methods">{item.methods.map((method) => <span key={method}>{method}</span>)}</div>
                )}

                {item.result && <p className="pe-result"><b>{cited ? "报道结果" : item.inferred ? "结果线索" : "结果"}</b>{item.result}</p>}

                {item.evidence.length > 0 && (
                  <div className="pe-evidence">
                    <span className="pe-evidenceLabel">证据</span>
                    {item.evidence.map((ref) => (
                      <button
                        key={`${ref.unit_id ?? ref.page}:${ref.snippet ?? ""}`}
                        type="button"
                        className="pe-page"
                        title={ref.snippet ? `原文线索：${ref.snippet}` : "打开原文证据页"}
                        onClick={() => { if (ref.unit_id) onJump(ref.unit_id); else if (ref.page) onPage(ref.page); }}
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
        {cited ? "这些实验来自综述引用的原始研究，证据页指向综述中的相关段落。" : "点击证据页核对原文。卡片顺序用于阅读定位。"}
      </p>
    </section>
  );
}
