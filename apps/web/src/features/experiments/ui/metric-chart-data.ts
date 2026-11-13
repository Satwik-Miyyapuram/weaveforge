/**
 * The data side of the metric chart: series on one step axis, smoothing, and
 * the per-metric view prefs. No DOM, so Node tests can import it.
 */

import type { MetricPoint } from "@weaveforge/core";

import { readyCore } from "@/lib/rust-core";
import { readStoredJson, writeStoredJson } from "@/lib/safe-storage";

export interface MetricSeries {
  id: string;
  /** Run label shown in legend (defaults to id). */
  label?: string;
  color?: string;
  /** Lower values draw underneath (older → newer stacking). */
  zOrder?: number;
  points: MetricPoint[];
}

/** Union step axis so overlaid runs with different step grids still compare fairly (wf-core `align_series`). */
export function alignSeries(series: MetricSeries[]) {
  return readyCore().alignSeries(series);
}

export const DEFAULT_COLORS = ["#5b8def", "#e06c75", "#98c379", "#d19a66", "#c678dd", "#56b6c2"];
export const SMOOTHING = [0, 0.6, 0.8, 0.95] as const;

/** Debiased EMA over non-null values; gaps stay gaps (wf-core `ema_smooth`). */
export function emaSmooth(values: (number | null)[], alpha: number): (number | null)[] {
  return readyCore().emaSmooth(values, alpha);
}

export interface Prefs {
  hidden: string[];
  smooth: number;
}

// Session-only view prefs per metric: kept across reloads, not across sessions.
export function readPrefs(metric: string): Prefs {
  const stored = readStoredJson<Partial<Prefs> | null>(`metric-chart:${metric}`, null, "session");
  return { hidden: [], smooth: 0, ...stored };
}

export function writePrefs(metric: string, prefs: Prefs) {
  writeStoredJson(`metric-chart:${metric}`, prefs, "session");
}

/**
 * Y-axis tick labels in one precision. The choice of precision is wf-core `tick_format`; the
 * strings are rendered here, where `toFixed` and `toExponential` define them.
 */
export function formatTicks(values: readonly number[]): string[] {
  const format = readyCore().tickFormat(values);
  if (format.kind === "plain") return values.map(String);
  if (format.kind === "exponential") {
    return values.map((v) => (Number.isFinite(v) ? v.toExponential(1) : String(v)));
  }
  return values.map((v) => (Number.isFinite(v) ? v.toFixed(format.digits) : String(v)));
}
