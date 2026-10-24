"use client";

import { useEffect, useRef, useState } from "react";

import { readStoredJson, writeStoredJson } from "@/lib/safe-storage";

/**
 * `key` for one project: a filter saved in project A is not one in project B.
 * With no project chosen the plain key stands.
 */
export function projectScopedKey(key: string, projectId: string | null | undefined): string {
  return projectId ? `${key}.${projectId}` : key;
}

/**
 * useState that persists to localStorage under `key` (JSON). SSR-safe: the
 * server and first client render use `initial`; the stored value is applied in
 * an effect after mount (avoids hydration mismatch). Writes are best-effort.
 *
 * When `key` changes the value is read again from the new key, or reset to
 * `initial` when nothing is stored there. Nothing is written to a key until it
 * has been read, so the old key's value never lands under the new one.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // Callers pass literals like `[]`, a new array each render: read it, do not
  // depend on it.
  const initialRef = useRef(initial);

  useEffect(() => {
    // JSON never parses to undefined, so undefined means "nothing usable stored".
    const stored = readStoredJson<T | undefined>(key, undefined);
    setValue(stored !== undefined ? stored : initialRef.current);
    setLoadedKey(key);
  }, [key]);

  useEffect(() => {
    if (loadedKey !== key) return;
    writeStoredJson(key, value);
  }, [key, value, loadedKey]);

  return [value, setValue];
}
