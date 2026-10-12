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

export async function updateWorkspace(change: WorkspaceChange): Promise<Workspace> {
  const result = await apiJson<Workspace>("/api/workspace", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change),
  });
  window.dispatchEvent(new Event("medread-workspace-updated"));
  return result;
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const refresh = useCallback(async () => {
    const result = await apiJson<Workspace>("/api/workspace");
    setWorkspace(result);
    return result;
  }, []);
  useEffect(() => {
    refresh().catch(() => {});
    const onChange = () => { refresh().catch(() => {}); };
    window.addEventListener("medread-workspace-updated", onChange);
    return () => window.removeEventListener("medread-workspace-updated", onChange);
  }, [refresh]);
  return { workspace, refresh };
}
