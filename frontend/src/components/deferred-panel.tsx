"use client";

import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";

class PanelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function deferredPanel<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  label: string,
  loadingClassName = "workspaceLoading",
) {
  let loaded: ComponentType<Props> | null = null;
  let request: Promise<ComponentType<Props>> | null = null;

  function loadPanel() {
    request ??= load().then(({ default: Panel }) => {
      loaded = Panel;
      return Panel;
    }).catch((error) => {
      // A failed import is retryable. Sharing only the in-flight or successful
      // import also keeps tab switches from downloading a panel twice.
      request = null;
      throw error;
    });
    return request;
  }

  return function DeferredPanel(props: Props) {
    const [Panel, setPanel] = useState(() => loaded);
    const [attempt, setAttempt] = useState(0);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
      if (Panel) return;
      let mounted = true;
      void loadPanel().then((resolved) => {
        if (mounted) setPanel(() => resolved);
      }).catch(() => {
        if (mounted) setFailed(true);
      });
      return () => { mounted = false; };
    }, [Panel, attempt]);

    function retry() {
      setFailed(false);
      setAttempt((count) => count + 1);
    }

    const fallback = <div className="researchError" role="alert">
      暂时无法打开{label}。 <button type="button" className="quietButton" onClick={retry}>重试打开{label}</button>
      {attempt > 0 && <> <button type="button" className="quietButton" onClick={() => window.location.reload()}>刷新页面</button></>}
    </div>;
    if (failed) return fallback;
    if (!Panel) return <p className={loadingClassName} role="status">正在打开{label}…</p>;
    return <PanelBoundary key={attempt} fallback={fallback}><Panel {...props} /></PanelBoundary>;
  };
}
