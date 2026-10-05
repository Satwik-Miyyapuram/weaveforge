// Below this card width chrome (axis titles, stats, legend text) is dropped for the plot.
export const COMPACT_PX = 300;
// Narrower cards squash plots past reading, so the zoom slider stops there.
export const MIN_CARD_PX = 280;
const ASPECT = 0.62;
const MIN_PLOT_PX = 150;

/** Plot height follows the card's own width, so a narrow card keeps a readable shape. */
export function plotHeight(width: number, base: number): number {
  if (width <= 0) return base;
  return Math.min(base, Math.max(MIN_PLOT_PX, Math.round(width * ASPECT)));
}
