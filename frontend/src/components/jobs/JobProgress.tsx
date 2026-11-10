"use client";

import { useEffect, useState } from "react";
import type { JobProgress as JobProgressData } from "@/lib/jobs";
import "./jobs.css";

type Props = {
  /** 未传阶段文案时的兜底标题。 */
  title?: string;
  stageLabel?: string | null;
  progress?: JobProgressData | null;
  /** 任务开始时间戳（Date.now()）。null/undefined 表示当前没有任务，组件不渲染。 */
  startedAt?: number | null;
  onCancel?: () => void;
  /** fixed 用于综合/设计页右下角悬浮（替代原 floatingBusy）；inline 嵌在分区里。 */
  variant?: "inline" | "fixed";
};

/** 为什么计时器放在组件里：三个页面都要显示「已等待 N 秒」，放组件内避免三份计时逻辑漂移。
 *  为什么文案分成 stageLabel + title：后端每次下发的 stage_label 是当下真实阶段，比页面猜的
 *  "正在组织证据" 更准；后端没给时才退回 title。 */
export default function JobProgress({ title = "正在处理", stageLabel, progress, startedAt, onCancel, variant = "inline" }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startedAt == null) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  if (startedAt == null) return null;

  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const label = (stageLabel || "").trim() || title;

  return (
    <div className={`jobProgress ${variant}`}>
      {/* role=status 只包文字：取消按钮是交互控件，放进 live region 会被反复播报。 */}
      <div className="jobProgressHead" role="status" aria-live="polite">
        <span className="jobProgressPulse" aria-hidden="true" />
        <strong>{label}</strong>
        <small>已等待 {elapsed} 秒</small>
      </div>
      {percent != null && (
        <div className="jobProgressBar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></div>
      )}
      <div className="jobProgressMeta">
        {progress && progress.total > 0 && <span className="jobProgressCount">{progress.done} / {progress.total}</span>}
        <span className="jobProgressHint">可以离开这一分区继续浏览，结果会保留</span>
        {onCancel && <button type="button" className="jobProgressCancel" onClick={onCancel}>取消</button>}
      </div>
    </div>
  );
}
