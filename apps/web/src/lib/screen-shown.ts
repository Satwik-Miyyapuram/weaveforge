"use client";

import { useEffect, useRef } from "react";

import { useScreenActive } from "@/lib/hooks/use-screen-active";

/**
 * User Timing marks for "this screen is on show with its content".
 *
 * Each screen marks `wf:screen:<name>:shown` once its content is rendered, and
 * a measure of the same name runs from the last navigation start
 * (`wf:nav:start`) — or from the window's start on a cold launch. A CDP script
 * reads them with `performance.getEntriesByName(name, "measure")`.
 *
 * Always on: a mark is a few bytes and only the newest of each name is kept,
 * so the buffer does not grow with use.
 */
const NAV_START = "wf:nav:start";

type Listener = (name: string) => void;
const listeners = new Set<Listener>();

function timing(): Performance | null {
  return typeof performance !== "undefined" && typeof performance.mark === "function" ? performance : null;
}

/** A navigation began: the next screen shown is measured from here. */
export function markNavStart(): void {
  const perf = timing();
  if (!perf) return;
  perf.clearMarks(NAV_START);
  perf.mark(NAV_START);
}

export function markScreenShown(name: string): void {
  const perf = timing();
  if (perf) {
    const label = `wf:screen:${name}:shown`;
    const start = perf.getEntriesByName(NAV_START, "mark").at(-1)?.startTime ?? 0;
    perf.clearMarks(label);
    perf.clearMeasures(label);
    const end = perf.mark(label).startTime;
    perf.measure(label, { start, end });
    // Used once: a later screen shown without a navigation is not timed from it.
    perf.clearMarks(NAV_START);
  }
  for (const listener of listeners) {
    try {
      listener(name);
    } catch {
      // A listener's failure is its own; the next one still hears.
    }
  }
}

/** Hear every screen shown. Returns the unsubscribe. */
export function onScreenShown(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Mark `name` shown when `ready` turns true while the screen is on show, and
 * again each time a kept-alive screen comes back (`useScreenActive`).
 */
export function useScreenShown(name: string, ready: boolean): void {
  const active = useScreenActive();
  const marked = useRef(false);
  useEffect(() => {
    if (!active) {
      marked.current = false;
      return;
    }
    if (!ready || marked.current) return;
    marked.current = true;
    markScreenShown(name);
  }, [name, ready, active]);
}
