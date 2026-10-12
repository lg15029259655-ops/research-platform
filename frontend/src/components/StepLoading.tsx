"use client";

export default function StepLoading({ title, steps }: { title: string; steps: string[] }) {
  return <div className="stepLoading" role="status" aria-live="polite"><strong>{title}</strong><div>
    {steps.map((step, index) => <span key={step}><i>{String(index + 1).padStart(2, "0")}</i>{step}</span>)}
  </div><small>正在处理，请稍候。步骤展示的是本次请求的工作内容，不代表已经完成。</small></div>;
}
