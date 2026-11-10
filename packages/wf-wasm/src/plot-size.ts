/**
 * Metric chart sizing (Rust `plot_size`), re-exported from index.ts.
 * Each function keeps the signature of the former apps/web/src/features/experiments/ui/plot-size.ts.
 */
import {
  plotTier as rawPlotTier,
  axisSpec as rawAxisSpec,
  plotHeight as rawPlotHeight,
  fitCols as rawFitCols,
} from "../pkg/wf_wasm.js";
import type { AxisSpec, PlotTier } from "./bindings.js";

/** The chart tier for a card width: `full`, `medium` or `compact`. */
export function plotTier(width: number): PlotTier {
  return rawPlotTier(width) as PlotTier;
}

/** uPlot axis sizing for a tier. */
export function axisSpec(tier: PlotTier): AxisSpec {
  return rawAxisSpec(tier) as AxisSpec;
}

/** Plot height for a card width, capped at `base`. */
export function plotHeight(width: number, base: number): number {
  return rawPlotHeight(width, base);
}

/** Columns that fit at the minimum card width, counting the grid gap. */
export function fitCols(gridWidth: number, gap: number): number {
  return rawFitCols(gridWidth, gap);
}
