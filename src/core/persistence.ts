/**
 * Tiny localStorage-backed persistence so the workbench survives a reload.
 * Every key is namespaced with `eztext:` and every failure is swallowed —
 * private browsing modes and quota errors must never break the app.
 */
import { useEffect, useState } from 'react';

const PREFIX = 'eztext:';

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore — persistence is best-effort */
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** `useState` that reads from and writes to localStorage (write is debounced). */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => loadJson(key, initial));

  useEffect(() => {
    const handle = window.setTimeout(() => saveJson(key, value), 250);
    return () => window.clearTimeout(handle);
  }, [key, value]);

  return [value, setValue] as const;
}
