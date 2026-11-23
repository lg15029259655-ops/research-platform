import { apiJson } from "@/lib/api";

export type PaperSummary = {
  id: string;
  title: string;
  original_filename: string;
  status: string;
  warning: string | null;
  openalex_id: string | null;
  domain: string | null;
};

export function readPaperLibrary(signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(10000);
  return apiJson<PaperSummary[]>("/api/papers?view=summary", {
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
}
