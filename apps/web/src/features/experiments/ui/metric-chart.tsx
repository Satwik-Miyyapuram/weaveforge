"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { MetricPoint } from "@weaveforge/core";
import { formatMetricValue } from "@weaveforge/core";
import { EntityCard } from "@/components/entity-card";
import { CardMenu } from "@/components/card-menu";
import { useGridHeight } from "./metric-grid";

// Lives in core so Node tests can import it without this file's CSS import.
export { formatMetricCell } from "@weaveforge/core";

export interface MetricSeries {
  id: string;
  /** Run label shown in legend (defaults to id). */
  label?: string;
  color?: string;
  /** Lower values draw underneath (older → newer stacking). */
  zOrder?: number;
  points: MetricPoint[];
}

interface MetricChartProps {
  /** Metric name from the SDK — used as the chart title. */
  metric: string;
  series: MetricSeries[];
  height?: number;
  /** Run toggles; default on when this chart overlays 2+ runs. */
  showLegend?: boolean;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Union step axis so overlaid runs with different step grids still compare fairly. */
function alignSeries(series: MetricSeries[]) {
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

const DEFAULT_COLORS = ["#5b8def", "#e06c75", "#98c379", "#d19a66", "#c678dd", "#56b6c2"];
const SMOOTHING = [0, 0.6, 0.8, 0.95] as const;
const COMPACT_PX = 260;

/** Debiased EMA over non-null values; gaps stay gaps. */
function emaSmooth(values: (number | null)[], alpha: number): (number | null)[] {
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

interface Prefs {
  hidden: string[];
  smooth: number;
}

// Session-only view prefs per metric: kept across reloads, not across sessions.
function readPrefs(metric: string): Prefs {
  try {
    const raw = sessionStorage.getItem(`metric-chart:${metric}`);
    if (raw) return { hidden: [], smooth: 0, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {}
  return { hidden: [], smooth: 0 };
}

function writePrefs(metric: string, prefs: Prefs) {
  try {
    sessionStorage.setItem(`metric-chart:${metric}`, JSON.stringify(prefs));
  } catch {}
}

interface Hover {
  step: number;
  left: number;
  top: number;
  flip: boolean;
  rows: { label: string; color: string; value: number }[];
}

/**
 * Canvas line chart (uPlot) in a card. Titles and series come from whatever
 * names the user logs via the SDK — no hard-coded accuracy/loss layout.
 */
export function MetricChart({ metric, series, height: baseHeight = 240, showLegend }: MetricChartProps) {
  const height = useGridHeight(baseHeight);
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // Run id for each uPlot series after x; raw lines are not the run's "main" line.
  const ownerRef = useRef<{ id: string; main: boolean }[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(readPrefs(metric).hidden));
  const [smooth, setSmooth] = useState<number>(() => readPrefs(metric).smooth);
  const [hover, setHover] = useState<Hover | null>(null);
  // Narrow cards (many per row) drop axis titles so the plot keeps its width.
  const [compact, setCompact] = useState(false);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  useEffect(() => {
    writePrefs(metric, { hidden: [...hidden], smooth });
  }, [metric, hidden, smooth]);

  const prepared = useMemo(() => {
    const nonEmpty = series
      .filter((s) => s.points.length > 0)
      .sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0));
    if (nonEmpty.length === 0) return null;
    const { steps, aligned } = alignSeries(nonEmpty);
    if (steps.length === 0) return null;
    const runs = aligned.map((s, i) => ({ ...s, color: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]! }));
    return { steps, runs, multi: runs.length > 1 };
  }, [series]);

  const stats = useMemo(() => {
    const points = series.flatMap((s) => s.points);
    if (points.length === 0) return null;
    const vals = points.map((p) => p.value);
    const latest = points.reduce((a, b) => (b.step >= a.step ? b : a));
    return { min: Math.min(...vals), max: Math.max(...vals), last: latest.value };
  }, [series]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !prepared) return;

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    void import("uplot").then(({ default: UPlot }) => {
      if (cancelled) return;

      const muted = readCssVar("--muted", "#8b949e");
      const line = readCssVar("--line", "#30363d");
      const surface = readCssVar("--surface", "#ffffff");
      const width = Math.max(el.clientWidth || 0, 1);
      setCompact(width < COMPACT_PX);
      const font = "11px system-ui, sans-serif";
      const labelFont = "600 11px system-ui, sans-serif";

      // Per run: faint raw line when smoothed, then the drawn line.
      const data: uPlot.AlignedData = [prepared.steps];
      const seriesOpts: uPlot.Series[] = [{}];
      const owner: { id: string; main: boolean }[] = [];
      for (const r of prepared.runs) {
        const show = !hiddenRef.current.has(r.id);
        if (smooth > 0) {
          data.push(r.values);
          seriesOpts.push({ label: `${r.label} raw`, stroke: `${r.color}40`, width: 1, spanGaps: true, show, points: { show: false } });
          owner.push({ id: r.id, main: false });
        }
        data.push(emaSmooth(r.values, smooth));
        seriesOpts.push({ label: r.label, stroke: r.color, width: 2, spanGaps: true, show });
        owner.push({ id: r.id, main: true });
      }
      ownerRef.current = owner;

      const axis = (extra: Partial<uPlot.Axis>): uPlot.Axis => ({
        stroke: muted,
        grid: { stroke: line, width: 1 },
        ticks: { stroke: line, width: 1, size: 4 },
        font,
        labelFont,
        gap: 4,
        ...extra,
      });

      const opts: uPlot.Options = {
        width,
        height,
        pxAlign: true,
        padding: [12, 14, 0, 0],
        scales: { x: { time: false }, y: { auto: true } },
        axes: [
          axis(compact ? { size: 24 } : { label: "step", labelSize: 22 }),
          axis({
            ...(compact ? { size: 50 } : { label: metric, labelSize: 20, size: 54 }),
            values: (_u, splits) => splits.map((v) => formatMetricValue(metric, v)),
          }),
        ],
        series: seriesOpts,
        legend: { show: false },
        cursor: {
          drag: { x: true, y: false, setScale: true },
          points: { size: (_u, i) => (owner[i - 1]?.main ? 10 : 0), width: 2, fill: surface },
        },
        hooks: {
          setCursor: [
            (u) => {
              const idx = u.cursor.idx;
              const left = u.cursor.left ?? -1;
              if (idx == null || left < 0) {
                setHover(null);
                return;
              }
              const rows: Hover["rows"] = [];
              owner.forEach((o, k) => {
                const s = u.series[k + 1]!;
                const v = u.data[k + 1]![idx];
                if (o.main && s.show && v != null) rows.push({ label: String(s.label), color: String(s.stroke), value: v });
              });
              const offset = u.bbox.left / devicePixelRatio;
              setHover(
                rows.length
                  ? {
                      step: u.data[0][idx]!,
                      left: left + offset,
                      top: (u.cursor.top ?? 0) + u.bbox.top / devicePixelRatio,
                      flip: left > u.bbox.width / devicePixelRatio / 2,
                      rows,
                    }
                  : null,
              );
            },
          ],
        },
      };

      plotRef.current?.destroy();
      plotRef.current = new UPlot(opts, data, el);

      resizeObserver = new ResizeObserver(() => {
        const w = el.clientWidth;
        if (w > 0) plotRef.current?.setSize({ width: w, height });
        if (w > 0) setCompact(w < COMPACT_PX);
      });
      resizeObserver.observe(el);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [metric, height, prepared, smooth, compact]);

  // A toggle flips series in place, so new data never brings a hidden run back.
  useEffect(() => {
    const u = plotRef.current;
    if (!u) return;
    ownerRef.current.forEach((o, k) => u.setSeries(k + 1, { show: !hidden.has(o.id) }));
  }, [hidden]);

  if (!prepared || !stats) return null;
  const wantLegend = showLegend ?? prepared.multi;
  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const smoothing = (
    <CardMenu
      label="Chart options"
      items={SMOOTHING.map((a) => ({
        id: String(a),
        label: `${a === smooth ? "✓ " : ""}smoothing: ${a === 0 ? "none" : `ema ${a}`}`,
        onSelect: () => setSmooth(a),
      }))}
    />
  );

  return (
    <EntityCard
      className="metric-chart"
      title={metric.split(/(?<=[/_])/).map((part, i) => (
        <span key={i}>
          {i > 0 && <wbr />}
          {part}
        </span>
      ))}
      menu={smoothing}
      meta={
        <span className="metric-chart-stats">
          <span>
            last <b>{formatMetricValue(metric, stats.last)}</b>
          </span>
          <span className="metric-chart-range">
            min <b>{formatMetricValue(metric, stats.min)}</b>
          </span>
          <span className="metric-chart-range">
            max <b>{formatMetricValue(metric, stats.max)}</b>
          </span>
        </span>
      }
    >
      {wantLegend && (
        <div className="metric-chart-legend" role="group" aria-label="Runs">
          {prepared.runs.map((r) => (
            <button
              key={r.id}
              type="button"
              className="metric-chart-run"
              aria-pressed={!hidden.has(r.id)}
              onClick={() => toggle(r.id)}
              title={hidden.has(r.id) ? "Show run" : "Hide run"}
            >
              <span className="metric-chart-swatch" style={{ background: r.color }} />
              {r.label}
            </button>
          ))}
        </div>
      )}
      <div className="metric-chart-plot-wrap">
        <div className="metric-chart-plot" ref={containerRef} role="img" aria-label={`${metric} over steps`} />
        {hover && (
          <div className="metric-chart-tip" data-flip={hover.flip || undefined} style={{ left: hover.left, top: hover.top }}>
            <div className="metric-chart-tip-step">step {hover.step}</div>
            {hover.rows.map((row) => (
              <div key={row.label} className="metric-chart-tip-row">
                <span className="metric-chart-swatch" style={{ background: row.color }} />
                <span>{row.label}</span>
                <b>{formatMetricValue(metric, row.value)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </EntityCard>
  );
}
