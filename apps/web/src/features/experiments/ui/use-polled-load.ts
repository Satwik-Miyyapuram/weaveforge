"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Loads once per `key`, then again every `pollMs` (none when null).
 *
 * The loader is read through a ref, so a caller passing a fresh closure each
 * render does not refetch; only a new key or interval does. An answer for an
 * old key, or one older than an answer already shown, is dropped. A success
 * clears the last error.
 */
export function usePolledLoad<T>(
  key: string,
  load: () => Promise<T>,
  pollMs: number | null,
): { data: T | null; error: unknown } {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const [state, setState] = useState<{ key: string; data: T | null; error: unknown }>({
    key,
    data: null,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    let sent = 0;
    let shown = 0;
    const run = () => {
      const mine = ++sent;
      loadRef.current().then(
        (data) => {
          if (!alive || mine < shown) return;
          shown = mine;
          setState({ key, data, error: null });
        },
        (error: unknown) => {
          if (!alive || mine < shown) return;
          shown = mine;
          setState((s) => ({ key, data: s.key === key ? s.data : null, error }));
        },
      );
    };
    run();
    const timer = pollMs == null ? null : setInterval(run, pollMs);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [key, pollMs]);

  // Until the new key's first answer lands, the old key's result is not shown.
  if (state.key !== key) return { data: null, error: null };
  return { data: state.data, error: state.error };
}
