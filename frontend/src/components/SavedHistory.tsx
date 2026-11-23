"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiJson } from "@/lib/api";

type Entry = { id: string; created_at: string };
type HistoryPage<T> = { items: T[]; next_before: string | null };
type HistoryProps<T> = {
  title: string; endpoint: string; currentId?: string | null; viewingId?: string | null; scroll?: boolean;
  href: (entry: T) => string;
  label: (entry: T) => string;
  metadata: (entry: T) => ReactNode;
};

export default function SavedHistory<T extends Entry>(props: HistoryProps<T>) {
  const [open, setOpen] = useState(false);
  return <details className="sectionBox synthesisHistory" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{props.title}</summary>
    {open && <HistoryEntries key={props.currentId || ""} {...props} />}
  </details>;
}

function HistoryEntries<T extends Entry>({ title, endpoint, currentId, viewingId, href, label, metadata, scroll }: HistoryProps<T>) {
  const [entries, setEntries] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);

  async function load(before: string | null = null) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setFailed(false);
    try {
      const params = before ? `?before=${encodeURIComponent(before)}` : "";
      const result = await apiJson<HistoryPage<T>>(`${endpoint}${params}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store",
      });
      if (controller.signal.aborted) return;
      setEntries((prior) => before ? [...prior, ...result.items] : result.items);
      setNext(result.next_before);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void load();
    return () => { request.current?.abort(); request.current = null; };
  }, []);

  return <>
    {!!entries.length && <ul>
      {entries.map((entry) => <li key={entry.id}>
        <p>
          <Link className="inlineLink" href={href(entry)} scroll={scroll}
            aria-current={entry.id === viewingId ? "page" : undefined}>
            {label(entry)}
          </Link>
          <br /><small><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("zh-CN")}</time> · {metadata(entry)}{entry.id === currentId ? " · 当前版本" : ""}</small>
        </p>
      </li>)}
    </ul>}
    {loading && <p className="workspaceLoading" role="status">正在读取{title}…</p>}
    {failed && <p className="researchError" role="alert">暂时无法读取{title}。 <button className="quietButton" onClick={() => void load(next)}>重试读取历史</button></p>}
    {!loading && !failed && !entries.length && <p>这里还没有已保存的记录。</p>}
    {!loading && !failed && next && <button className="quietButton" onClick={() => void load(next)}>加载更早的记录</button>}
  </>;
}
