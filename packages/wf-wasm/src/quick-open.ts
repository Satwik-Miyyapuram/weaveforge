/**
 * Quick open ranking and palette groups (Rust `editor_workspace::quick_open`),
 * re-exported from index.ts. The Enter-to-pick check stays with the dialog,
 * since it reads keyboard composition state and is not part of the ranking.
 */
import {
  groupResults as rawGroupResults,
  paintedOrder as rawPaintedOrder,
  quickOpenResults as rawQuickOpenResults,
  stepCursor as rawStepCursor,
  titleOf as rawTitleOf,
} from "../pkg/wf_wasm.js";

import type { QuickOpenGroup, QuickOpenResult, WorkspaceTreeNode } from "./bindings.js";

export type { QuickOpenGroup, QuickOpenResult };

/** Rank documents against a query; an empty query lists everything. */
export function quickOpenResults(
  documents: readonly WorkspaceTreeNode[],
  query: string,
): QuickOpenResult[] {
  return rawQuickOpenResults(documents, query);
}

/** Split score-ordered hits into palette groups without re-sorting them. */
export function groupResults(results: readonly QuickOpenResult[]): QuickOpenGroup[] {
  return rawGroupResults(results);
}

/** The results in the order the palette paints them. Keyboard navigation walks this. */
export function paintedOrder(results: readonly QuickOpenResult[]): QuickOpenResult[] {
  return rawPaintedOrder(results);
}

/** The row an arrow lands on; it wraps, and a stale cursor steps from the last row. */
export function stepCursor(cursor: number, delta: 1 | -1, length: number): number {
  return rawStepCursor(cursor, delta, length);
}

/** What a row is called in the palette: its title, which its label may not be. */
export function titleOf(node: WorkspaceTreeNode): string {
  return rawTitleOf(node);
}
