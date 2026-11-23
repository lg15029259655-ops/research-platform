"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api";
import { requestJobCancellation, submitJob, watchJob, type JobProgress } from "@/lib/jobs";

type Kind = "compare" | "novelty" | "design";
type Scope = "synthesis" | "design";
type Draft = { idea: string; constraints?: string; key?: string };
type Ticket = { id: string; kind: Kind; startedAt: number; draft?: Draft };
type Job = {
  kind: Kind; startedAt: number; stage: string; progress: JobProgress | null;
  status: "running" | "done" | "failed" | "canceled"; result?: unknown; error?: string; draft?: Draft;
  reconnecting?: boolean; cancelPending?: boolean; cancelError?: string;
};
type ActiveJob = { preparation: AbortController; ticket?: Ticket };

function createJobStore(scope: Scope) {
  const storageKey = `medread-job-${scope}`;
  let current: Job | null = null;
  let active: ActiveJob | null = null;
  const listeners = new Set<() => void>();

  function publish(job: Job | null) {
    current = job;
    listeners.forEach((listener) => listener());
  }

  function update(change: Partial<Job>) {
    if (current) publish({ ...current, ...change });
  }

  async function sendCancellation(running: ActiveJob, ticket: Ticket) {
    try {
      await requestJobCancellation(ticket.id);
    } catch (error) {
      if (running !== active || current?.status !== "running") return;
      if (error instanceof ApiError && error.status === 404) return; // Monitor the terminal snapshot.
      update({ cancelPending: false, cancelError: "暂未确认取消，仍在跟踪任务。可以重试取消。" });
    }
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
    const running: ActiveJob = { preparation: new AbortController() };
    active = running;
    const { signal } = running.preparation;
    const job: Job = { kind, startedAt, draft, stage: "", progress: null, status: "running" };
    publish(job);
    try {
      const ticket = await getTicket(signal);
      running.ticket = ticket;
      remember(ticket);
      if (current?.cancelPending) void sendCancellation(running, ticket);
      const snapshot = await watchJob(ticket.id, {
        onStage: (_stage, label) => update({ stage: label }),
        onProgress: (progress) => update({ progress }),
        onConnection: (connected) => update({ reconnecting: !connected }),
      });
      if (snapshot.status === "done" || snapshot.status === "failed" || snapshot.status === "canceled") {
        update({ status: snapshot.status, result: snapshot.result, error: snapshot.error?.message });
      } else {
        update({ status: "failed", error: "暂时无法确认任务结果，请重试" });
      }
    } catch (error) {
      update(signal.aborted && !running.ticket && error instanceof DOMException && error.name === "AbortError" ? { status: "canceled" } : {
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
        void run(saved.kind, saved.startedAt, saved.draft, async () => saved);
      }
    },
    start(kind: Kind, params: Record<string, unknown>, options?: { draft?: Draft }) {
      const startedAt = Date.now();
      const draft = options?.draft;
      return run(kind, startedAt, draft, async (signal) => {
        signal.throwIfAborted();
        const response = await submitJob(kind, params);
        return { id: response.id, kind, startedAt, draft };
      });
    },
    cancel() {
      if (!active || current?.status !== "running" || current.cancelPending) return;
      update({ cancelPending: true, cancelError: "" });
      if (active.ticket) void sendCancellation(active, active.ticket);
      else active.preparation.abort();
    },
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
