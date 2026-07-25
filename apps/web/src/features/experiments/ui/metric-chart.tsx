"use client";

import { useEffect, useMemo, useRef } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { MetricPoint } from "@thesis/core";
import { formatMetricValue } from "@thesis/core";

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
  /** uPlot series legend; defaults on when this chart overlays 2+ runs. */
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

/**
 * Canvas line chart (uPlot) for experiment metrics. Titles and series come from
 * whatever names the user logs via the SDK — no hard-coded accuracy/loss layout.
 */
export function MetricChart({ metric, series, height = 240, showLegend }: MetricChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const prepared = useMemo(() => {
    const nonEmpty = series
      .filter((s) => s.points.length > 0)
      .sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0));
    if (nonEmpty.length === 0) return null;
    const { steps, aligned } = alignSeries(nonEmpty);
    if (steps.length === 0) return null;
    const data: uPlot.AlignedData = [steps];
    for (const s of aligned) data.push(s.values);
    return { steps, aligned, data, multi: aligned.length > 1 };
  }, [series]);

  const range = useMemo(() => {
    const vals = series.flatMap((s) => s.points.map((p) => p.value));
    if (vals.length === 0) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
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
      const accent = readCssVar("--accent", "#3e5a78");
      const chip = readCssVar("--chip", "#161b22");
      const width = Math.max(el.clientWidth || 0, 1);
      const wantLegend = showLegend ?? prepared.multi;

      const seriesOpts: uPlot.Series[] = [
        {},
        ...prepared.aligned.map((s, i) => ({
          label: s.label,
          stroke: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] ?? accent,
          width: 2,
          spanGaps: true,
        })),
      ];

      const opts: uPlot.Options = {
        width,
        height,
        pxAlign: true,
        scales: { x: { time: false }, y: { auto: true } },
        axes: [
          {
            stroke: muted,
            grid: { stroke: line, width: 1 },
            ticks: { stroke: muted },
            label: "step",
            labelFont: "12px system-ui, sans-serif",
            labelGap: 8,
            font: "11px system-ui, sans-serif",
            gap: 6,
          },
          {
            stroke: muted,
            grid: { stroke: line, width: 1 },
            ticks: { stroke: muted },
            side: 3,
            size: 56,
            font: "11px system-ui, sans-serif",
            values: (_u, splits) => splits.map((v) => formatMetricValue(metric, v)),
          },
        ],
        series: seriesOpts,
        legend: { show: wantLegend && prepared.multi, live: false },
        cursor: {
          drag: { x: true, y: false, setScale: true },
          points: { show: prepared.aligned.length <= 6, size: 5 },
        },
        hooks: {
          drawClear: [
            (u) => {
              u.ctx.fillStyle = chip;
              u.ctx.fillRect(0, 0, u.bbox.width, u.bbox.height);
            },
          ],
        },
      };

      if (plotRef.current) {
        plotRef.current.setSize({ width, height });
        plotRef.current.setData(prepared.data);
      } else {
        plotRef.current = new UPlot(opts, prepared.data, el);
      }

      resizeObserver = new ResizeObserver(() => {
        const w = el.clientWidth;
        if (w > 0) plotRef.current?.setSize({ width: w, height });
      });
      resizeObserver.observe(el);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [metric, height, prepared, showLegend]);

  if (!prepared || !range) return null;

  return (
    <figure className="metric-chart">
      <figcaption>
        <span className="metric-chart-title">{metric}</span>
        <span className="muted metric-chart-range">
          {formatMetricValue(metric, range.min)} – {formatMetricValue(metric, range.max)}
        </span>
      </figcaption>
      <div className="metric-chart-plot" ref={containerRef} role="img" aria-label={`${metric} over steps`} />
    </figure>
  );
}

export function formatMetricCell(_metric: string, value: unknown): string {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return String(value ?? "—");
  return formatMetricValue(_metric, n);
}
