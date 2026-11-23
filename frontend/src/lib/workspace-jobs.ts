"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api";
import { findJobSubmission, requestJobCancellation, submitJob, watchJob, type JobProgress, type JobSnapshot } from "@/lib/jobs";

type Kind = "compare" | "novelty" | "design";
type Scope = "synthesis" | "design";
type Draft = { idea: string; constraints?: string; key?: string };
type JobIntent = { kind: Kind; startedAt: number; draft?: Draft; cancelRequested?: boolean };
type Ticket = JobIntent & { id: string };
type Submission = JobIntent & { requestId: string };
type Job = {
  kind: Kind; startedAt: number; stage: string; progress: JobProgress | null;
  status: "running" | "done" | "failed" | "canceled"; result?: unknown; error?: string; draft?: Draft;
  reconnecting?: boolean; cancelPending?: boolean; cancelError?: string;
};
type ActiveJob = { record: Submission | Ticket };

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

  function remember(ticket: Submission | Ticket | null) {
    try {
      if (ticket) window.sessionStorage.setItem(storageKey, JSON.stringify(ticket));
      else window.sessionStorage.removeItem(storageKey);
    } catch { /* Browsing still works when storage is unavailable. */ }
  }

  async function recoverSubmission(requestId: string) {
    let delay = 500;
    let missing = 0;
    for (;;) {
      try {
        return await findJobSubmission(requestId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          if (++missing === 4) throw new Error("未找到已接收的任务，可以重新提交。");
        } else if (error instanceof ApiError && error.status < 500 && error.status !== 429) {
          throw error;
        } else {
          missing = 0;
        }
        update({ reconnecting: true, stage: "正在核对提交状态" });
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 4000);
      }
    }
  }

  async function run(record: Submission | Ticket, params?: Record<string, unknown>) {
    if (active) return;
    const running: ActiveJob = { record };
    active = running;
    const { kind, startedAt, draft, cancelRequested } = record;
    remember(record);
    const stage = "requestId" in record ? (params ? "正在提交任务" : "正在核对提交状态") : "";
    const job: Job = { kind, startedAt, draft, stage, progress: null, status: "running", cancelPending: cancelRequested };
    publish(job);
    try {
      let ticket: Ticket;
      let snapshot: JobSnapshot | undefined;
      if ("requestId" in record) {
        const requestId = record.requestId;
        snapshot = params
          ? await submitJob(kind, params, requestId).catch((error) => {
            if (error instanceof ApiError && error.status < 500 && error.status !== 429) throw error;
            return recoverSubmission(requestId);
          })
          : await recoverSubmission(requestId);
        ticket = { id: snapshot.id, kind, startedAt, draft, cancelRequested: running.record.cancelRequested };
        running.record = ticket;
        remember(ticket);
        update({ reconnecting: false });
      } else {
        ticket = record;
      }
      if (!snapshot || snapshot.status === "queued" || snapshot.status === "running") {
        if (current?.cancelPending) void sendCancellation(running, ticket);
        snapshot = await watchJob(ticket.id, {
          onStage: (_stage, label) => update({ stage: label }),
          onProgress: (progress) => update({ progress }),
          onConnection: (connected) => update({ reconnecting: !connected }),
        });
      }
      if (snapshot.status === "done" || snapshot.status === "failed" || snapshot.status === "canceled") {
        update({ status: snapshot.status, result: snapshot.result, error: snapshot.error?.message });
      } else {
        update({ status: "failed", error: "暂时无法确认任务结果，请重试" });
      }
    } catch (error) {
      update({ status: "failed", error: error instanceof Error ? error.message : "任务未完成，请重试" });
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
      let record: Submission | Ticket | null = null;
      try { record = JSON.parse(window.sessionStorage.getItem(storageKey) || "null"); }
      catch { remember(null); }
      if (record && typeof record === "object" && ("id" in record ? typeof record.id === "string" : typeof record.requestId === "string")
          && Number.isFinite(record.startedAt)
          && (scope === "synthesis" ? record.kind === "compare" : ["novelty", "design"].includes(record.kind))) {
        void run(record);
      }
    },
    start(kind: Kind, params: Record<string, unknown>, options?: { draft?: Draft }) {
      return run({ requestId: crypto.randomUUID(), kind, startedAt: Date.now(), draft: options?.draft }, params);
    },
    cancel() {
      if (!active || current?.status !== "running" || current.cancelPending) return;
      update({ cancelPending: true, cancelError: "" });
      active.record.cancelRequested = true;
      remember(active.record);
      if ("id" in active.record) void sendCancellation(active, active.record);
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
