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
const subscribers = new Set<(workspace: Workspace) => void>();

function publish(workspace: Workspace) {
  cached = workspace;
  subscribers.forEach((subscriber) => subscriber(workspace));
}

function loadWorkspace(): Promise<Workspace> {
  if (pending) return pending;
  const started = revision;
  const request = apiJson<Workspace>("/api/workspace").then((result) => {
    if (started === revision) publish(result);
    return started === revision ? result : (cached || result);
  }).finally(() => { if (pending === request) pending = null; });
  pending = request;
  return request;
}

export function updateWorkspace(change: WorkspaceChange | ((workspace: Workspace) => WorkspaceChange | null)): Promise<Workspace> {
  const request = writes.then(async () => {
    let patch = change;
    if (typeof change === "function") {
      const current = cached ?? await loadWorkspace();
      const next = change(current);
      if (!next) return current;
      patch = next;
    }
    const result = await apiJson<Workspace>("/api/workspace", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    revision += 1;
    publish(result);
    return result;
  });
  writes = request.catch(() => {});
  return request;
}

export function addPaperToSynthesis(id: string) {
  return updateWorkspace(({ selected_paper_ids: ids }) => {
    if (ids.includes(id)) return null;
    if (ids.length >= 5) throw new Error("待综合列表最多 5 篇，请先移除一篇");
    return { selected_paper_ids: [...ids, id] };
  });
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(cached);
  const [workspaceError, setWorkspaceError] = useState("");
  const refresh = useCallback(async () => {
    setWorkspaceError("");
    try {
      return await loadWorkspace();
    } catch (error) {
      setWorkspaceError("研究工作区暂时无法读取");
      throw error;
    }
  }, []);
  useEffect(() => {
    subscribers.add(setWorkspace);
    if (cached) setWorkspace(cached);
    refresh().catch(() => {});
    return () => { subscribers.delete(setWorkspace); };
  }, [refresh]);
  return { workspace, refresh, workspaceError };
}
