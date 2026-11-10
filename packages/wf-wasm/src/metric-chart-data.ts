/**
 * Metric chart data (Rust `metric_chart_data`): the union step axis, EMA smoothing and the
 * tick-format decision. The tick strings are rendered in the web app, where `toFixed` and
 * `toExponential` define them.
 */
import {
  alignSeries as rawAlignSeries,
  emaSmooth as rawEmaSmooth,
  tickFormat as rawTickFormat,
} from "../pkg/wf_wasm.js";
import type { AlignedChart, ChartSeries, TickFormat } from "./bindings.js";

export type { AlignedChart, AlignedSeries, ChartPoint, ChartSeries, TickFormat } from "./bindings.js";

/** Overlaid runs on one union step axis, gaps as `null`. */
export function alignSeries(series: ChartSeries[]): AlignedChart {
  return rawAlignSeries(series) as AlignedChart;
}

/** Debiased EMA over the non-gap values; gaps stay gaps. An `alpha` at or below zero is a no-op. */
export function emaSmooth(values: (number | null)[], alpha: number): (number | null)[] {
  return rawEmaSmooth(values, alpha) as (number | null)[];
}

/** How the tick labels are rendered for these values. */
export function tickFormat(values: readonly number[]): TickFormat {
  return rawTickFormat(values) as TickFormat;
}
