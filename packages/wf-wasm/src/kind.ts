/**
 * Per-kind table and lookups for the editor workspace (Rust `editor_workspace::kind`).
 * The table lives in Rust; these wrappers only type the results for the screen.
 */
import {
  kindIconClass as rawKindIconClass,
  kindNames as rawKindNames,
  memberRank as rawMemberRank,
  modesFor as rawModesFor,
  segmentsFor as rawSegmentsFor,
} from "../pkg/wf_wasm.js";
import type {
  DocumentMode,
  StatusSegment,
  TreeNodeKind,
} from "./bindings.js";

export {
  defaultModeFor,
  documentKind,
  documentSuffix,
  hasInkView,
  hasLazyBody,
  hasPdfView,
  isCreatableKind,
  isDocumentKind,
  kindIcon,
  kindOwner,
  kindSuffix,
  kindTintClass,
  linkGroupOf,
  openModeFor,
  openingTab,
} from "../pkg/wf_wasm.js";

/** Every kind the explorer can show, the grouping `folder` last. */
export function kindNames(): readonly TreeNodeKind[] {
  return rawKindNames();
}

/** Papers before notes inside a reading list. Unknown kinds sort last. */
export function memberRank(kind: string): number {
  // Rust's "no rank" is i32::MAX; callers have always seen Number.MAX_SAFE_INTEGER.
  const rank = rawMemberRank(kind);
  return rank === 2147483647 ? Number.MAX_SAFE_INTEGER : rank;
}

/** The tint class for a row's icon; an open folder is accent, a closed one untinted. */
export function kindIconClass(kind: string, open = false): string | null {
  return rawKindIconClass(kind, open);
}

export function modesFor(kind: string): readonly DocumentMode[] {
  return rawModesFor(kind);
}

export function segmentsFor(kind: string): readonly StatusSegment[] {
  return rawSegmentsFor(kind);
}
