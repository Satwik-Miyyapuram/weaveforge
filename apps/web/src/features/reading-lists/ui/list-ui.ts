/** Preset list colors (matches graph/status palette). */
export const LIST_COLOR_PRESETS = [
  "#7c9885",
  "#5a7d8c",
  "#c98a6b",
  "#9a7bb0",
  "#c0573f",
  "#8a857c",
] as const;

/** What a swatch is called to a screen reader, in preset order (DA-78). */
export const LIST_COLOR_NAMES = ["Sage", "Slate blue", "Terracotta", "Lavender", "Brick red", "Stone"] as const;

/** Suffix shown after a screening verdict for the other reviewers on an item. */
export function otherReviewersLabel(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return " (1 other reviewer)";
  return ` (${count} other reviewers)`;
}
