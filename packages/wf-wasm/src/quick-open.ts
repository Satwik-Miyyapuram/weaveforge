/**
 * Quick open ranking and palette groups (Rust `editor_workspace::quick_open`),
 * re-exported from index.ts. The Enter-to-pick check stays with the dialog,
 * since it reads keyboard composition state and is not part of the ranking.
 */
import {
  groupResults as rawGroupResults,
  paintedOrder as rawPaintedOrder,
  quickOpenResults as rawQuickOpenResults,
} from "../pkg/wf_wasm.js";

import type {
  QuickOpenGroup,
  QuickOpenResult,
  WorkspaceTreeNode,
} from "./bindings.js";

export {
  stepCursor,
  titleOf,
} from "../pkg/wf_wasm.js";

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

