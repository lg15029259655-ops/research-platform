import type { KeyboardEvent } from "react";

/** 一组 tab 的通用行为：role / aria-selected / tabIndex 管理，方向键与 Home / End 切换并同步焦点。
 *  用法：
 *    const tabs = tabGroup(["a", "b"] as const, current, select);
 *    <div className="tabBar" {...tabs.list} aria-label="…">
 *      <button {...tabs.item("a")}>A</button>
 *    </div>
 *  某个 tab 被选中时还要做别的事（例如触发一次请求），把该动作作为第二个参数传给 item。
 *  注意：方向键必须走同一个动作。只调 select() 会让「鼠标点」和「键盘切」行为不一致——
 *  X-Ray 就是靠 item 的第二参数发请求的，键盘切过去会停在只有 tab 高亮、内容永远空着的状态。 */
export function tabGroup<T extends string>(values: readonly T[], current: T, select: (value: T) => void) {
  const actions = new Map<T, () => void>();
  const activate = (value: T) => {
    const action = actions.get(value);
    if (action) action(); else select(value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = Math.max(0, values.indexOf(current));
    const next = event.key === "Home" ? 0
      : event.key === "End" ? values.length - 1
      : event.key === "ArrowLeft" ? (index + values.length - 1) % values.length
      : (index + 1) % values.length;
    activate(values[next]);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return {
    list: { role: "tablist" as const, onKeyDown },
    item: (value: T, onSelect?: () => void) => {
      if (onSelect) actions.set(value, onSelect);
      return {
        role: "tab" as const,
        "aria-selected": value === current,
        tabIndex: value === current ? 0 : -1,
        className: value === current ? "active" : "",
        onClick: () => activate(value),
      };
    },
  };
}
