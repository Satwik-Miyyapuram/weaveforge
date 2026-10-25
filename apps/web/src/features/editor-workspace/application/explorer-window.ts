/**
 * Which explorer rows are painted (M04).
 *
 * A vault of thousands of files used to paint every row, each a dozen
 * elements with its icons and hover actions, nearly all of them scrolled out
 * of sight. Rows are a fixed height, so the rows in view follow from the
 * scroll position alone; the rest stand in as gaps of the same height, which
 * keeps the scrollbar and every offset where they were.
 */

/** One row's height, matching `.explorer-row` in editor-workspace.css. */
export const EXPLORER_ROW_PX = 25;
/** Painted before the panel has a size to measure: more than a screenful. */
export const EXPLORER_FIRST_PAINT_ROWS = 60;
/** Painted past each edge of the view, so a scroll never shows a blank row. */
export const EXPLORER_OVERSCAN_ROWS = 12;

/** Where one section's rows sit in the scroller, all in CSS px. */
export interface ExplorerViewport {
  scrollTop: number;
  /** The scroller's visible height. */
  height: number;
  /** The top of the section's first row inside the scrolled content. */
  rowsTop: number;
}

export type RowSlot = { kind: "row"; index: number } | { kind: "gap"; rows: number };

/**
 * The section's rows as painted rows and gaps, in order.
 *
 * `pinned` rows are painted wherever they are: the focused row, a rename or a
 * draft in progress would otherwise unmount as the list scrolls away from
 * them, and lose the focus or the text being typed. `viewport` is null until
 * the panel has been measured.
 */
export function rowSlots(
  count: number,
  viewport: ExplorerViewport | null,
  pinned: Iterable<number>,
): RowSlot[] {
  let start = 0;
  let end = Math.min(count, EXPLORER_FIRST_PAINT_ROWS);
  if (viewport) {
    const top = viewport.scrollTop - viewport.rowsTop;
    start = Math.max(0, Math.floor(top / EXPLORER_ROW_PX) - EXPLORER_OVERSCAN_ROWS);
    end = Math.min(
      count,
      Math.ceil((top + viewport.height) / EXPLORER_ROW_PX) + EXPLORER_OVERSCAN_ROWS,
    );
  }

  const indices = new Set<number>();
  for (let i = start; i < end; i++) indices.add(i);
  for (const i of pinned) if (Number.isInteger(i) && i >= 0 && i < count) indices.add(i);

  const slots: RowSlot[] = [];
  let next = 0;
  for (const index of [...indices].sort((a, b) => a - b)) {
    if (index > next) slots.push({ kind: "gap", rows: index - next });
    slots.push({ kind: "row", index });
    next = index + 1;
  }
  if (count > next) slots.push({ kind: "gap", rows: count - next });
  return slots;
}
