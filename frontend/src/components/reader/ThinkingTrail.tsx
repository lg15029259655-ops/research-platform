"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./reader.css";

type Props = {
  /** 模型思考过程的累计文本（来自 SSE 的 thinking 事件）。 */
  text: string;
  /** 是否仍在生成。true 自动展开，false 自动收起（用户仍可手动展开回看）。 */
  active: boolean;
};

/** 思考轨迹：模型在出正文前的推理过程，折叠展示。
 *
 *  为什么要有它：这个模型是思考模式，首正文 token 往往要 20 秒以上；这段时间里
 *  SSE 除了少数字段外没有任何内容，用户会以为卡死。把已经算出来的思考流出来，
 *  "看起来在干活"本身就是体验的一部分，而且不改变答案质量。
 *  为什么折叠：思考文本很长且不是最终结论，默认展开会把正文挤走；完成后自动收起。
 *  为什么不写进消息历史：它不是给用户的回答，刷新后不应出现。
 */
export default function ThinkingTrail({ text, active }: Props) {
  const [open, setOpen] = useState(active);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();

  // pending 时展开、完成后收起；用户手动切换会被下一次状态变化覆盖，
  // 这正是想要的：每一轮新的讲解都从"展开"开始，结束后收回。
  useEffect(() => { setOpen(active); }, [active]);
  useEffect(() => {
    const box = bodyRef.current;
    if (box && open && active) box.scrollTop = box.scrollHeight;
  }, [text, open, active]);

  if (!text.trim()) return null;

  return (
    <section className={`thinkingTrail${active ? " active" : ""}`} aria-label="模型思考轨迹">
      <button
        type="button"
        className="thinkingTrailHead"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="thinkingTrailDot" aria-hidden="true" />
        <strong>{active ? "思考轨迹 · 正在分析原文" : "思考轨迹 · 已完成"}</strong>
        <small>{text.length} 字</small>
        <i aria-hidden="true">{open ? "收起" : "展开"}</i>
      </button>
      {open && (
        <div className="thinkingTrailBody" id={bodyId} ref={bodyRef} role="note" aria-label="思考内容">
          {text}
        </div>
      )}
    </section>
  );
}
