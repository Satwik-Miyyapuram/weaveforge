/**
 * The jump palette's headings, page matches and key hints (DA-99). Pure, so the
 * palette component only renders what these return.
 */
import { shortcutLabel } from "./shortcut-label";

/** Headings in the order the palette shows them. */
export const PALETTE_GROUPS = [
  "Recent",
  "Pages",
  "Papers",
  "Notes",
  "Report sections",
  "In papers",
  "Actions",
] as const;

export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

export interface PaletteRow {
  group: PaletteGroup;
  key: string;
}

/** Rows under their headings, in `PALETTE_GROUPS` order; order inside a group is kept. */
export function groupPaletteRows<T extends PaletteRow>(
  rows: readonly T[],
): { label: PaletteGroup; rows: T[] }[] {
  return PALETTE_GROUPS.map((label) => ({
    label,
    rows: rows.filter((row) => row.group === label),
  })).filter((group) => group.rows.length > 0);
}

/** Pages whose name holds the query; names that start with it first. Nothing for an empty query. */
export function matchingPages<T extends { label: string }>(
  pages: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = pages.filter((page) => page.label.toLowerCase().includes(q));
  const starts = (page: T) => (page.label.toLowerCase().startsWith(q) ? 0 : 1);
  return hits.sort((a, b) => starts(a) - starts(b));
}

/** The footer's key chips, with the platform's own modifier. */
export function paletteKeys(mac: boolean): { keys: string[]; label: string }[] {
  return [
    { keys: ["↑", "↓"], label: "move" },
    { keys: ["Enter"], label: "open" },
    { keys: ["Esc"], label: "close" },
    { keys: [shortcutLabel("⌘K", mac)], label: "from anywhere" },
  ];
}
