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

export async function updateWorkspace(change: WorkspaceChange): Promise<Workspace> {
  const result = await apiJson<Workspace>("/api/workspace", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change),
  });
  revision += 1;
  publish(result);
  return result;
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(cached);
  const refresh = useCallback(async () => {
    return loadWorkspace();
  }, []);
  useEffect(() => {
    subscribers.add(setWorkspace);
    refresh().catch(() => {});
    return () => { subscribers.delete(setWorkspace); };
  }, [refresh]);
  return { workspace, refresh };
}
