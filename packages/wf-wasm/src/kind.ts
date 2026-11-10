/**
 * Per-kind table and lookups for the editor workspace (Rust `editor_workspace::kind`).
 * The table lives in Rust; these wrappers only type the results for the screen.
 */
import {
  kindIconClass as rawKindIconClass,
  memberRank as rawMemberRank,
} from "../pkg/wf_wasm.js";

export {
  kindNames,
  modesFor,
  segmentsFor,
} from "../pkg/wf_wasm.js";

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

