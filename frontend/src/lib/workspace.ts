"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api";

export type Workspace = {
  workspace_id: string; query: string; domain: string; study_type: string;
  selected_paper_ids: string[]; core_paper_id: string | null;
  synthesis_id: string | null; research_gap: string; gap_context: Record<string, unknown>;
  design_idea: string; novelty_id: string | null; design_version_id: string | null;
  created_at: string; updated_at: string;
};
export type WorkspaceChange = Partial<Pick<Workspace, "query" | "domain" | "study_type" |
  "selected_paper_ids" | "core_paper_id" | "synthesis_id" | "research_gap" |
  "gap_context" | "design_idea" | "novelty_id" | "design_version_id">>;

let cached: Workspace | null = null;
let pending: Promise<Workspace> | null = null;
let writes: Promise<unknown> = Promise.resolve();
let revision = 0;
let channel: BroadcastChannel | undefined;
let watching = false;
const subscribers = new Set<(workspace: Workspace) => void>();

function publish(workspace: Workspace) {
  cached = workspace;
  subscribers.forEach((subscriber) => subscriber(workspace));
}

function loadWorkspace(afterPending = false): Promise<Workspace> {
  if (pending) return afterPending ? pending.catch(() => {}).then(() => loadWorkspace()) : pending;
  const started = revision;
  const request = apiJson<Workspace>("/api/workspace", { signal: AbortSignal.timeout(10000) }).then((result) => {
    if (started === revision) publish(result);
    return started === revision ? result : (cached || result);
  }).finally(() => { if (pending === request) pending = null; });
  pending = request;
  return request;
}

function watchOtherTabs() {
  if (watching) return;
  watching = true;
  const reload = () => {
    if (subscribers.size) void loadWorkspace(true).catch(() => {});
  };
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("medread-workspace");
    channel.onmessage = reload;
  }
  window.addEventListener("focus", reload);
}

function queueWorkspaceWrite(send: () => Promise<Workspace>): Promise<Workspace> {
  const request = writes.then(async () => {
    const result = await send();
    revision += 1;
    publish(result);
    channel?.postMessage("changed");
    return result;
  });
  writes = request.catch(() => {});
  return request;
}

export class WorkspaceSaveUnconfirmed extends Error {
  constructor() { super("暂时无法确认工作区是否已保存，请重试。"); }
}

export function updateWorkspace(change: WorkspaceChange, expectedQuery?: string) {
  return queueWorkspaceWrite(async () => {
    const signal = AbortSignal.timeout(10000);
    try {
      return await apiJson<Workspace>("/api/workspace", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...change, expected_query: expectedQuery }), signal,
      });
    } catch (error) {
      if (signal.aborted || error instanceof TypeError) throw new WorkspaceSaveUnconfirmed();
      throw error;
    }
  });
}

export function setPaperInSynthesis(id: string, selected: boolean, query: string) {
  return queueWorkspaceWrite(() => apiJson<Workspace>("/api/workspace/selection", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper_id: id, selected, query }),
    signal: AbortSignal.timeout(10000),
  }));
}

export function changeWorkspaceTopic(topic: Pick<Workspace, "query" | "domain" | "study_type">, expectedUpdatedAt: string) {
  return queueWorkspaceWrite(() => apiJson<Workspace>("/api/workspace/topic", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...topic, expected_updated_at: expectedUpdatedAt }),
    signal: AbortSignal.timeout(10000),
  }));
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(cached);
  const [workspaceError, setWorkspaceError] = useState("");
  const refresh = useCallback(async (afterPending = false) => {
    setWorkspaceError("");
    try {
      return await loadWorkspace(afterPending);
    } catch (error) {
      setWorkspaceError("研究工作区暂时无法读取");
      throw error;
    }
  }, []);
  useEffect(() => {
    subscribers.add(setWorkspace);
    watchOtherTabs();
    if (cached) setWorkspace(cached);
    refresh().catch(() => {});
    return () => { subscribers.delete(setWorkspace); };
  }, [refresh]);
  return { workspace, refresh, workspaceError };
}
