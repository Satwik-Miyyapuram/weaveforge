"use client";

import { useEffect, useState } from "react";

/**
 * useState that persists to localStorage under `key` (JSON). SSR-safe: the
 * server and first client render use `initial`; the stored value is applied in
 * an effect after mount (avoids hydration mismatch). Writes are best-effort.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored != null) setValue(JSON.parse(stored) as T);
    } catch {
      /* ignore malformed / unavailable storage */
    }
    setLoaded(true);
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value, loaded]);

  return [value, setValue];
}
