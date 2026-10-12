"use client";

import { ReactNode } from "react";

export default function EvidenceDrawer({ title, eyebrow, children, onClose, action }: {
  title: string; eyebrow?: string; children: ReactNode; onClose: () => void;
  action?: { label: string; onClick: () => void };
}) {
  return <aside className="evidenceDrawer" role="dialog" aria-label={title}>
    <div className="drawerHead"><span>{eyebrow || "证据详情"}</span><button onClick={onClose} aria-label="关闭详情">×</button></div>
    <h3>{title}</h3><div className="drawerBody">{children}</div>
    {action && <button className="drawerAction" onClick={action.onClick}>{action.label}</button>}
  </aside>;
}
