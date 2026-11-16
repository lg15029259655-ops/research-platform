"use client";

import { useState } from "react";
import { categoryById, iconUrl } from "@/lib/experiment-categories";
import "./experiment-icon.css";

/** 优先使用独立图标，缺失时复用现有生物分类图集。 */
export default function ExperimentIcon({ category, size = 44, showLabel = false }: {
  category: string | null;
  size?: number;
  showLabel?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const meta = categoryById(category);
  const artwork: Record<string, [string, string]> = { data_analysis: ["biological-core-v1.png", "0 0"], cell_experiment: ["biological-core-v1.png", "100% 0"], animal_experiment: ["biological-core-v1.png", "0 100%"], molecular_experiment: ["biological-core-v1.png", "100% 100%"], clinical_sample: ["biological-support-v1.png", "100% 0"], imaging: ["biological-methods-v1.png", "100% 100%"], materials_prep: ["workflow-extra-v1.png", "0 0"], engineering_test: ["workflow-extra-v1.png", "50% 0"], modeling_algorithm: ["workflow-extra-v1.png", "100% 0"], survey_statistics: ["workflow-extra-v1.png", "0 100%"], result_conclusion: ["workflow-extra-v1.png", "50% 100%"] };
  const fallback = meta && artwork[meta.id];
  if (!meta) return null;

  return (
    <span className="exp-icon" style={{ width: size, height: size }} title={`${meta.name}（图标：${iconUrl(meta.id)}）`}>
      {failed && fallback ? (
        <span aria-hidden="true" style={{ width: "100%", height: "100%", backgroundImage: `url(/research-elements/${fallback[0]})`, backgroundSize: fallback[0] === "workflow-extra-v1.png" ? "300% 200%" : "200% 200%", backgroundPosition: fallback[1], borderRadius: 8 }} />
      ) : failed ? (
        <span className="exp-icon-slot" aria-label={`${meta.name}图标待插入`}>
          <span style={{ fontSize: Math.max(9, Math.round(size / 4.6)) }}>{meta.short}</span>
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 运行时可选资源，用原生 img 才能拿到 onError 回退
        <img
          className="exp-icon-img"
          src={iconUrl(meta.id)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      {showLabel && <span className="exp-icon-label">{meta.short}</span>}
    </span>
  );
}
