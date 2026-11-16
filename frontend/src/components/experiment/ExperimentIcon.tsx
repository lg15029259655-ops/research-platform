"use client";

import { useState } from "react";
import { categoryById, iconUrl } from "@/lib/experiment-categories";
import "./experiment-icon.css";

/**
 * 实验分类图标。
 *
 * 图片由使用者自己生成（见 docs/experiment-icon-manifest.md），放到
 * `public/icons/experiments/<id>.png`。文件还没放进来时显示虚线占位框，
 * 不放图片也能看到布局，放进来后刷新页面即可自动生效（public 资源无需重建）。
 */
export default function ExperimentIcon({ category, size = 44, showLabel = false }: {
  category: string | null;
  size?: number;
  showLabel?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const meta = categoryById(category);
  if (!meta) return null;

  return (
    <span className="exp-icon" style={{ width: size, height: size }} title={`${meta.name}（图标：${iconUrl(meta.id)}）`}>
      {failed ? (
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
