"use client";

import { ReactNode, useEffect, useRef } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";

export default function EvidenceDrawer({ title, eyebrow, children, onClose, action }: {
  title: string; eyebrow?: string; children: ReactNode; onClose: () => void;
  action?: { label: string; onClick: () => void };
}) {
  const rootRef = useRef<HTMLElement>(null);
  // onClose 是调用方内联的箭头函数，每次父组件重渲染都会换新引用。
  // 若把它写进 useFocusTrap 的依赖数组，画布上一划动鼠标就会重建焦点陷阱、把焦点拽回首元素。
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  // 焦点陷阱实现已提取到 lib/useFocusTrap（空依赖 + closeRef），行为与原内联实现一致。
  useFocusTrap(rootRef, closeRef);

  return <aside ref={rootRef} className="evidenceDrawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
    <div className="drawerHead"><span>{eyebrow || "证据详情"}</span><button type="button" onClick={onClose} aria-label="关闭详情">×</button></div>
    <h3>{title}</h3><div className="drawerBody">{children}</div>
    {action && <button className="drawerAction" onClick={action.onClick}>{action.label}</button>}
  </aside>;
}
