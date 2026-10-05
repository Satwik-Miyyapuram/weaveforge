export type PlotTier = "full" | "medium" | "compact";

// Card widths where chrome steps down: medium drops axis titles and min/max, compact keeps only swatches.
export const MEDIUM_PX = 560;
export const COMPACT_PX = 360;
// Narrower cards squash plots past reading, so the zoom slider stops there.
export const MIN_CARD_PX = 280;
const MIN_PLOT_PX = 180;

export function plotTier(width: number): PlotTier {
  if (width <= 0 || width >= MEDIUM_PX) return "full";
  return width >= COMPACT_PX ? "medium" : "compact";
}

/** uPlot axis sizing per tier: smaller font and gutters so narrow cards keep their plot area. */
export function axisSpec(tier: PlotTier) {
  if (tier === "full") return { font: 11, ySize: 54, xSize: 22, xSpace: 60, ySpace: 30, titles: true };
  if (tier === "medium") return { font: 10, ySize: 46, xSize: 22, xSpace: 50, ySpace: 28, titles: false };
  return { font: 10, ySize: 46, xSize: 20, xSpace: 44, ySpace: 26, titles: false };
}

/** Narrow cards get a taller aspect so chrome above the plot never outweighs it. */
export function plotHeight(width: number, base: number): number {
  if (width <= 0) return base;
  const aspect = width < COMPACT_PX ? 0.85 : width < MEDIUM_PX ? 0.65 : 0.5;
  return Math.min(base, Math.max(MIN_PLOT_PX, Math.round(width * aspect)));
}

/** Columns that fit at MIN_CARD_PX, counting the grid gap between cards. */
export function fitCols(gridWidth: number, gap: number): number {
  return Math.max(1, Math.floor((gridWidth + gap) / (MIN_CARD_PX + gap)));
}
