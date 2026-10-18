import { RefObject, useEffect, useRef } from "react";

// 可聚焦元素选择器：与 EvidenceDrawer 原实现逐字一致。
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/**
 * 焦点陷阱 hook：把 EvidenceDrawer 里那段实现原样提取出来，供抽屉与首页说明弹窗共用。
 *
 * 行为（原样保留）：
 *   记录进入前的 document.activeElement → 聚焦容器内 [data-autofocus]（无则首个可聚焦元素，再退回容器本身）
 *   → 捕获阶段监听 keydown：Escape 调 closeRef.current()；Tab / Shift+Tab 在首尾之间循环，
 *     且当焦点已跑到容器外时也拉回容器内 → 卸载时把焦点还给进入前的元素。
 *
 * 依赖数组必须是 []（硬契约）：closeRef 由调用方维护最新引用，
 * 若把 onClose 写进依赖数组，父组件每次重渲染（例如画布上划动鼠标）都会重建陷阱、把焦点拽回首元素。
 */
export function useFocusTrap(rootRef: RefObject<HTMLElement | null>, closeRef: RefObject<() => void>) {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.getClientRects().length > 0);
    // 初始焦点：容器内 [data-autofocus] 优先，其次首个可聚焦元素，最后退回容器本身。
    const preferred = root.querySelector<HTMLElement>("[data-autofocus]");
    (preferred || focusable()[0] || root).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); root!.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !root!.contains(active);
      if (event.shiftKey && (active === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || outside)) { event.preventDefault(); first.focus(); }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const target = restoreRef.current;
      if (target && document.contains(target)) target.focus();
    };
  }, []); // 空依赖：仅挂载时建立一次陷阱
}
