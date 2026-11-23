"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiJson } from "@/lib/api";

type Entry = { id: string; created_at: string; paper_count: number; titles: string[] };
type HistoryPage = { items: Entry[]; next_before: string | null };

export default function SynthesisHistory({ currentId, viewingId }: {
  currentId?: string | null; viewingId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return <details className="sectionBox synthesisHistory" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>综合历史</summary>
    {open && <HistoryEntries key={currentId || ""} currentId={currentId} viewingId={viewingId} />}
  </details>;
}

function HistoryEntries({ currentId, viewingId }: { currentId?: string | null; viewingId?: string | null }) {
  const [entries, setEntries] = useState<Entry[]>([]);
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
      const result = await apiJson<HistoryPage>(`/api/research/comparisons${params}`, {
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
          <Link className="inlineLink" href={`/synthesis?artifact=${encodeURIComponent(entry.id)}`} scroll={false}
            aria-current={entry.id === viewingId ? "page" : undefined}>
            {entry.titles.length ? entry.titles.join(" · ") : `${entry.paper_count} 篇论文的综合`}
          </Link>
          <br /><small><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("zh-CN")}</time> · {entry.paper_count} 篇论文{entry.id === currentId ? " · 当前综合" : ""}</small>
        </p>
      </li>)}
    </ul>}
    {loading && <p className="workspaceLoading" role="status">正在读取综合历史…</p>}
    {failed && <p className="researchError" role="alert">暂时无法读取综合历史。 <button className="quietButton" onClick={() => void load(next)}>重试读取历史</button></p>}
    {!loading && !failed && !entries.length && <p>还没有已保存的综合结果。</p>}
    {!loading && !failed && next && <button className="quietButton" onClick={() => void load(next)}>加载更早的综合</button>}
  </>;
}
