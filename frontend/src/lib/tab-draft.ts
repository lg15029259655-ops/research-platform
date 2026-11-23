"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const fallback = new Map<string, string | null>();
const storageKey = (key: string) => `medread-draft:${key}`;

function readRaw(key: string | null): string | null {
  if (key === null) return null;
  if (fallback.has(key)) return fallback.get(key) ?? null;
  try { return window.sessionStorage.getItem(storageKey(key)); }
  catch { return null; }
}

function parseDraft<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try { return JSON.parse(raw) as T; }
  catch { return null; }
}

export function readTabDraft<T>(key: string): T | null {
  return parseDraft<T>(readRaw(key));
}

export function writeTabDraft<T>(key: string, value: T | null) {
  const raw = value === null ? null : JSON.stringify(value);
  try {
    if (raw === null) window.sessionStorage.removeItem(storageKey(key));
    else window.sessionStorage.setItem(storageKey(key), raw);
    fallback.delete(key);
  } catch {
    fallback.set(key, raw);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTabDraft<T>(key: string | null) {
  const getSnapshot = useCallback(() => readRaw(key), [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const draft = useMemo(() => parseDraft<T>(raw), [raw]);
  const write = useCallback((value: T | null) => {
    if (key !== null) writeTabDraft(key, value);
  }, [key]);
  return [draft, write] as const;
}
