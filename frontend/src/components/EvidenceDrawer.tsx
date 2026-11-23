"use client";

import { ReactNode, useLayoutEffect, useRef } from "react";

export default function EvidenceDrawer({ title, eyebrow, children, onClose, action }: {
  title: string; eyebrow?: string; children: ReactNode; onClose: () => void;
  action?: { label: string; onClick: () => void };
}) {
  const rootRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const drawer = rootRef.current;
    if (!drawer) return;
    drawer.showModal();
    return () => { if (drawer.open) drawer.close(); };
  }, []);

  return <dialog ref={rootRef} className="evidenceDrawer" aria-label={title}
    onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="drawerHead"><span>{eyebrow || "证据详情"}</span><button type="button" onClick={onClose} aria-label="关闭详情">×</button></div>
    <h3>{title}</h3><div className="drawerBody">{children}</div>
    {action && <button className="drawerAction" onClick={action.onClick}>{action.label}</button>}
  </dialog>;
}
