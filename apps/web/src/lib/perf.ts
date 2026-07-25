/**
 * Dev-only timings for responsive UI work. Values deliberately contain
 * no user content, IDs, or URLs so they remain safe to inspect in DevTools.
 *
 * Common keys: screen.{id}.memory_cache_hit, screen.{id}.idb_ms,
 * screen.{id}.fetch_ms, nav.overlay_skipped, nav.cache_hit, nav.route_ms
 */

type PerfTimings = Record<string, number>;

declare global {
  interface Window {
    __thesisPerf?: PerfTimings;
  }
}

function enabled(): boolean {
  return process.env.NODE_ENV !== "production" && typeof window !== "undefined";
}

export function recordPerf(name: string, valueMs: number): void {
  if (!enabled()) return;
  const store = (window.__thesisPerf ??= {});
  store[name] = Math.round(valueMs * 10) / 10;
}

export function perfNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function recordPerfSince(name: string, startedAt: number): void {
  recordPerf(name, perfNow() - startedAt);
}
