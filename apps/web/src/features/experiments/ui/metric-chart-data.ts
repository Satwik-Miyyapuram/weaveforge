/**
 * The data side of the metric chart: series on one step axis, smoothing, and
 * the per-metric view prefs. No DOM, so Node tests can import it.
 */

import type { MetricPoint } from "@weaveforge/core";

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

/** Union step axis so overlaid runs with different step grids still compare fairly. */
export function alignSeries(series: MetricSeries[]) {
  const sorted = series.map((s) => ({
    ...s,
    points: [...s.points].sort((a, b) => a.step - b.step),
  }));
  const stepSet = new Set<number>();
  for (const s of sorted) {
    for (const p of s.points) stepSet.add(p.step);
  }
  const steps = [...stepSet].sort((a, b) => a - b);
  const aligned = sorted.map((s) => {
    const byStep = new Map(s.points.map((p) => [p.step, p.value]));
    return {
      id: s.id,
      label: s.label ?? s.id.slice(0, 8),
      color: s.color,
      values: steps.map((step) => byStep.get(step) ?? null),
    };
  });
  return { steps, aligned };
}

export const DEFAULT_COLORS = ["#5b8def", "#e06c75", "#98c379", "#d19a66", "#c678dd", "#56b6c2"];
export const SMOOTHING = [0, 0.6, 0.8, 0.95] as const;

/** Debiased EMA over non-null values; gaps stay gaps. */
export function emaSmooth(values: (number | null)[], alpha: number): (number | null)[] {
  if (alpha <= 0) return values;
  let acc = 0;
  let n = 0;
  return values.map((v) => {
    if (v == null) return null;
    acc = alpha * acc + (1 - alpha) * v;
    n += 1;
    return acc / (1 - alpha ** n);
  });
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
