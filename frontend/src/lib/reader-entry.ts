import { apiJson } from "@/lib/api";

let prepared: { id: string; detail: unknown; expiresAt: number } | null = null;

export async function prepareReaderEntry(id: string, signal: AbortSignal) {
  const detail = await apiJson(`/api/papers/${encodeURIComponent(id)}`, { signal, cache: "no-store" });
  signal.throwIfAborted();
  prepared = { id, detail, expiresAt: Date.now() + 10000 };
}

export function getReaderEntry<T>(id: string): T | undefined {
  if (!prepared) return;
  if (prepared.expiresAt <= Date.now()) {
    prepared = null;
    return;
  }
  return prepared.id === id ? prepared.detail as T : undefined;
}

export function invalidateReaderEntry(id: string) {
  if (prepared?.id === id) prepared = null;
}
