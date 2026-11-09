/**
 * Command palette ordering and keys (Rust `command_palette`), re-exported from index.ts.
 */
import {
  commandMatchIndices as rawCommandMatchIndices,
  groupPaletteRows as rawGroupPaletteRows,
  isPreviewKey as rawIsPreviewKey,
  matchingPageIndices as rawMatchingPageIndices,
  paletteModeFor as rawPaletteModeFor,
  sortHitOrder as rawSortHitOrder,
} from "../pkg/wf_wasm.js";
import type {
  GroupedRows,
  HitKey,
  HitSort,
  PaletteGroup,
  PaletteKey,
  PaletteMode,
} from "./bindings.js";
import { checkIndexText } from "./text-check.js";

/** The indices of `rows` in the chosen hit order (Rust `sort_hit_order`). */
export function sortHitOrder(rows: readonly HitKey[], order: HitSort): number[] {
  return rawSortHitOrder(rows, order) as number[];
}

/** Whether a key press opens the preview (Rust `is_preview_key`). */
export function isPreviewKey(event: PaletteKey, inTextBox: boolean): boolean {
  return rawIsPreviewKey(event, inTextBox) as boolean;
}

/** The headings present, in display order, each with the indices of its rows (Rust `group_palette_rows`). */
export function groupPaletteRows(groups: readonly PaletteGroup[]): GroupedRows[] {
  return rawGroupPaletteRows(groups) as GroupedRows[];
}

/** The indices of the labels that hold the query, names that start with it first (Rust `matching_page_indices`). */
export function matchingPageIndices(labels: readonly string[], query: string): number[] {
  checkIndexText(query);
  return rawMatchingPageIndices(labels, query) as number[];
}

/** Every index for an empty query, else the page rule (Rust `command_match_indices`). */
export function commandMatchIndices(labels: readonly string[], query: string): number[] {
  checkIndexText(query);
  return rawCommandMatchIndices(labels, query) as number[];
}

/** The palette mode a key press opens, or `null` (Rust `palette_mode_for`). */
export function paletteModeFor(event: PaletteKey): PaletteMode | null {
  return (rawPaletteModeFor(event) as PaletteMode | undefined) ?? null;
}
