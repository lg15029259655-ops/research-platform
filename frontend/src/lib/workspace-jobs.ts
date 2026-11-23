"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ensureSession } from "@/lib/api";
import { submitJob, watchJob, type JobProgress } from "@/lib/jobs";

type Kind = "compare" | "novelty" | "design";
type Scope = "synthesis" | "design";
type Draft = { idea: string; constraints?: string };
type Ticket = { id: string; kind: Kind; startedAt: number; draft?: Draft };
type Job = {
  kind: Kind; startedAt: number; stage: string; progress: JobProgress | null;
  status: "running" | "done" | "failed" | "canceled"; result?: unknown; error?: string; draft?: Draft;
};

function createJobStore(scope: Scope) {
  const storageKey = `medread-job-${scope}`;
  let current: Job | null = null;
  let active: AbortController | null = null;
  const listeners = new Set<() => void>();

  function publish(job: Job | null) {
    current = job;
    listeners.forEach((listener) => listener());
  }

  function remember(ticket: Ticket | null) {
    try {
      if (ticket) window.sessionStorage.setItem(storageKey, JSON.stringify(ticket));
      else window.sessionStorage.removeItem(storageKey);
    } catch { /* Browsing still works when storage is unavailable. */ }
  }

  async function run(kind: Kind, startedAt: number, draft: Draft | undefined,
                     getTicket: (signal: AbortSignal) => Promise<Ticket>) {
    if (active) return;
    const controller = new AbortController();
    active = controller;
    const { signal } = controller;
    const job: Job = { kind, startedAt, draft, stage: "", progress: null, status: "running" };
    publish(job);
    function update(change: Partial<Job>) {
      if (current) publish({ ...current, ...change });
    }
    try {
      const ticket = await getTicket(signal);
      remember(ticket);
      const snapshot = await watchJob(ticket.id, {
        onStage: (_stage, label) => update({ stage: label }),
        onProgress: (progress) => update({ progress }),
      }, signal);
      if (snapshot.status === "done" || snapshot.status === "failed" || snapshot.status === "canceled") {
        update({ status: snapshot.status, result: snapshot.result, error: snapshot.error?.message });
      } else {
        update({ status: "failed", error: "暂时无法确认任务结果，请重试" });
      }
    } catch (error) {
      update(signal.aborted ? { status: "canceled" } : {
        status: "failed", error: error instanceof Error ? error.message : "任务未完成，请重试",
      });
    } finally {
      active = null;
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => current,
    restore() {
      if (current) return;
      let ticket: Ticket | null = null;
      try { ticket = JSON.parse(window.sessionStorage.getItem(storageKey) || "null"); }
      catch { remember(null); }
      if (typeof ticket?.id === "string" && Number.isFinite(ticket.startedAt)
          && (scope === "synthesis" ? ticket.kind === "compare" : ["novelty", "design"].includes(ticket.kind))) {
        const saved = ticket;
        void run(saved.kind, saved.startedAt, saved.draft, async () => { await ensureSession(); return saved; });
      }
    },
    start(kind: Kind, params: Record<string, unknown>, options?: { after?: Promise<unknown>; draft?: Draft }) {
      const startedAt = Date.now();
      const draft = options?.draft;
      return run(kind, startedAt, draft, async (signal) => {
        await options?.after;
        signal.throwIfAborted();
        const response = await submitJob(kind, params);
        return { id: response.id, kind, startedAt, draft };
      });
    },
    cancel() { active?.abort(); },
    dismiss(job: Job) {
      if (current === job && job.status !== "running") { remember(null); publish(null); }
    },
  };
}

const stores = { synthesis: createJobStore("synthesis"), design: createJobStore("design") };
const serverSnapshot = () => null;

export function useWorkspaceJob(scope: Scope) {
  const store = stores[scope];
  const job = useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
  useEffect(() => store.restore(), [store]);
  return { job, start: store.start, cancel: store.cancel, dismiss: store.dismiss };
}
