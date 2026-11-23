import { apiJson } from "@/lib/api";

export type PaperSummary = {
  id: string;
  title: string;
  original_filename: string;
  status: string;
  warning: string | null;
  openalex_id: string | null;
  domain: string | null;
  source_matches: boolean;
};

type PaperStatus = { status: string; source_matches?: boolean };
type PaperLibraryChange = { paperId: string; removed: boolean };
const paperLibraryChannel = "medread-paper-library";
let librarySource: string | undefined;
const parsingStatuses = new Set(["uploaded", "reading", "structure", "figures", "manifest", "images"]);

export function isPdfParsing(status: string) {
  return parsingStatuses.has(status);
}

export function hasParsedPdf(paper?: PaperStatus) {
  return paper?.status === "parsed" && paper.source_matches !== false;
}

export function paperLibraryIssue(paper?: PaperStatus) {
  if (!paper) return "记录暂不可用";
  if (paper.status === "parsed") return "PDF 与已保存的阅读内容不一致";
  if (isPdfParsing(paper.status)) return "PDF 正在解析";
  return paper.status === "failed" ? "PDF 解析失败" : "尚未上传可解析的 PDF";
}

export function readPaperLibrary(signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(10000);
  return apiJson<PaperSummary[]>("/api/papers?view=summary", {
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
}

export function notifyPaperLibraryChange(paperId: string, removed = false) {
  if (typeof BroadcastChannel === "undefined") return;
  librarySource ??= crypto.randomUUID();
  const channel = new BroadcastChannel(paperLibraryChannel);
  channel.postMessage({ paperId, removed, source: librarySource });
  channel.close();
}

export function subscribeToPaperLibrary(listener: (change: PaperLibraryChange) => void) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(paperLibraryChannel);
  channel.onmessage = ({ data }) => {
    if (typeof data?.paperId === "string" && typeof data.removed === "boolean" &&
        typeof data.source === "string" && data.source !== librarySource) listener(data);
  };
  return () => channel.close();
}
