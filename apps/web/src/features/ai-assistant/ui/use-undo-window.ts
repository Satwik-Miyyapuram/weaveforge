"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Scheduled {
  label: string;
  ids: ReadonlySet<string>;
  run: () => void;
}

/**
 * Hold a bulk action for a few seconds before it runs, so it can be undone.
 *
 * Nothing is written during the window, which is what makes undo safe for
 * approvals too: an applied note edit has no generic inverse, but an edit that
 * never ran needs none. Scheduling a second action runs the first one now, and
 * leaving the screen runs whatever is waiting, since the reviewer asked for it.
 */
export function useUndoWindow(ms = 5000) {
  const [scheduled, setScheduled] = useState<Scheduled | null>(null);
  const current = useRef<{ entry: Scheduled; timer: ReturnType<typeof setTimeout> } | null>(null);

  const flush = useCallback(() => {
    const now = current.current;
    if (!now) return;
    clearTimeout(now.timer);
    current.current = null;
    setScheduled(null);
    now.entry.run();
  }, []);

  const schedule = useCallback(
    (label: string, ids: readonly string[], run: () => void) => {
      flush();
      const entry = { label, ids: new Set(ids), run };
      current.current = { entry, timer: setTimeout(flush, ms) };
      setScheduled(entry);
    },
    [flush, ms],
  );

  const undo = useCallback(() => {
    if (current.current) clearTimeout(current.current.timer);
    current.current = null;
    setScheduled(null);
  }, []);

  useEffect(() => flush, [flush]);

  return { scheduled, schedule, undo };
}
