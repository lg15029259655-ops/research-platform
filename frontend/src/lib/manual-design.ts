import { ApiError, apiJson } from "@/lib/api";

export function readManualDesignReceipt<T>(requestId: string) {
  return apiJson<T>(`/api/research/design/manual/receipts/${encodeURIComponent(requestId)}`, {
    cache: "no-store", signal: AbortSignal.timeout(8000),
  });
}

export async function saveManualDesign<T>(artifactId: string, design: unknown, requestId: string) {
  const signal = AbortSignal.timeout(10000);
  try {
    return await apiJson<T>("/api/research/design/manual", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifact_id: artifactId, design, request_id: requestId }), signal,
    });
  } catch (error) {
    if (!signal.aborted && !(error instanceof TypeError) && !(error instanceof ApiError && error.status >= 500)) throw error;
    const saved = await readManualDesignReceipt<T>(requestId).catch(() => null);
    if (saved) return saved;
    if (error instanceof ApiError && !signal.aborted) throw error;
    throw new Error("暂时无法确认方案是否已保存，草稿可继续重试。");
  }
}
