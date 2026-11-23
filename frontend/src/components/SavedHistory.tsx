"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiJson } from "@/lib/api";
import { readTabDraft, useTabDraft, writeTabDraft } from "@/lib/tab-draft";

type Entry = { id: string; created_at: string };
type HistoryPage<T> = { items: T[]; next_before: string | null };
type HistoryState<T> = { open?: boolean; page?: HistoryPage<T>; loadedFor?: string; anchorId?: string };
type HistoryProps<T> = {
  title: string; endpoint: string; workspaceId?: string; currentId?: string | null; viewingId?: string | null; scroll?: boolean;
  href: (entry: T) => string;
  label: (entry: T) => string;
  metadata: (entry: T) => ReactNode;
};

export default function SavedHistory<T extends Entry>(props: HistoryProps<T>) {
  const historyKey = props.workspaceId ? `saved-history:${props.workspaceId}:${props.endpoint}` : null;
  const [state, remember] = useTabDraft<HistoryState<T>>(historyKey);
  const [openBeforeWorkspace, setOpenBeforeWorkspace] = useState(false);
  const open = state?.open ?? openBeforeWorkspace;
  return <details className="sectionBox synthesisHistory" open={open} onToggle={(event) => {
    const next = event.currentTarget.open;
    if (next === open) return;
    setOpenBeforeWorkspace(next);
    if (historyKey) remember({ ...readTabDraft<HistoryState<T>>(historyKey), open: next,
      ...(next ? { loadedFor: undefined } : {}) });
  }}>
    <summary>{props.title}</summary>
    {open && (historyKey ? <HistoryEntries key={historyKey} historyKey={historyKey} state={state} {...props} />
      : <p className="workspaceLoading" role="status">正在读取工作区…</p>)}
  </details>;
}

function mergeHistory<T extends Entry>(previous: HistoryPage<T> | undefined, next: HistoryPage<T>, append: boolean): HistoryPage<T> {
  if (!previous) return next;
  const nextIds = new Set(next.items.map((entry) => entry.id));
  if (append) {
    const known = new Set(previous.items.map((entry) => entry.id));
    return { items: [...previous.items, ...next.items.filter((entry) => !known.has(entry.id))], next_before: next.next_before };
  }
  const overlap = previous.items.findLastIndex((entry) => nextIds.has(entry.id));
  const older = overlap >= 0 && next.next_before ? previous.items.slice(overlap + 1) : [];
  return older.length ? { items: [...next.items, ...older], next_before: previous.next_before } : next;
}

function HistoryEntries<T extends Entry>({ title, endpoint, currentId, viewingId, href, label, metadata, scroll, historyKey, state }: HistoryProps<T> & {
  historyKey: string; state: HistoryState<T> | null;
}) {
  const [loading, setLoading] = useState(!state?.page);
  const [failedBefore, setFailedBefore] = useState<string | null>();
  const entries = state?.page?.items ?? [];
  const next = state?.page?.next_before;
  const request = useRef<AbortController | null>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());

  function updateHistory(change: HistoryState<T>) {
    writeTabDraft(historyKey, { ...readTabDraft<HistoryState<T>>(historyKey), ...change });
  }

  async function load(before: string | null = null) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setFailedBefore(undefined);
    try {
      const params = before ? `?before=${encodeURIComponent(before)}` : "";
      const result = await apiJson<HistoryPage<T>>(`${endpoint}${params}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store",
      });
      if (controller.signal.aborted) return;
      const latest = readTabDraft<HistoryState<T>>(historyKey);
      updateHistory({ open: latest?.open ?? true,
        page: mergeHistory(latest?.page, result, before !== null), loadedFor: currentId ?? "" });
    } catch {
      if (!controller.signal.aborted) setFailedBefore(before);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const cached = readTabDraft<HistoryState<T>>(historyKey);
    if (!cached?.page || cached.loadedFor !== (currentId ?? "")) void load();
    return () => { request.current?.abort(); request.current = null; };
  }, [currentId, historyKey]);

  useEffect(() => {
    const anchor = readTabDraft<HistoryState<T>>(historyKey)?.anchorId;
    if (!anchor || anchor === viewingId) return;
    const link = links.current.get(anchor);
    if (!link) return;
    const frame = requestAnimationFrame(() => {
      if (link.isConnected) {
        link.focus();
        updateHistory({ anchorId: undefined });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [historyKey, viewingId]);

  return <>
    {!!entries.length && <ul>
      {entries.map((entry) => <li key={entry.id}>
        <p>
          <Link className="inlineLink" href={href(entry)} scroll={scroll}
            ref={(node) => { if (node) links.current.set(entry.id, node); else links.current.delete(entry.id); }}
            onNavigate={() => updateHistory({ anchorId: entry.id })}
            aria-current={entry.id === viewingId ? "page" : undefined}>
            {label(entry)}
          </Link>
          <br /><small><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("zh-CN")}</time> · {metadata(entry)}{entry.id === currentId ? " · 当前版本" : ""}</small>
        </p>
      </li>)}
    </ul>}
    {loading && <p className="workspaceLoading" role="status">正在读取{title}…</p>}
    {failedBefore !== undefined && <p className="researchError" role="alert">暂时无法读取{title}。 <button className="quietButton" onClick={() => void load(failedBefore)}>重试读取历史</button></p>}
    {!loading && failedBefore === undefined && !entries.length && <p>这里还没有已保存的记录。</p>}
    {!loading && failedBefore === undefined && next && <button className="quietButton" onClick={() => void load(next)}>加载更早的记录</button>}
  </>;
}
