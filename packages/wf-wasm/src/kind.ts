/**
 * Per-kind table and lookups for the editor workspace (Rust `editor_workspace::kind`).
 * The table lives in Rust; these wrappers only type the results for the screen.
 */
import {
  defaultModeFor as rawDefaultModeFor,
  documentKind as rawDocumentKind,
  documentSuffix as rawDocumentSuffix,
  hasInkView as rawHasInkView,
  hasLazyBody as rawHasLazyBody,
  hasPdfView as rawHasPdfView,
  isCreatableKind as rawIsCreatableKind,
  isDocumentKind as rawIsDocumentKind,
  kindIcon as rawKindIcon,
  kindIconClass as rawKindIconClass,
  kindNames as rawKindNames,
  kindOwner as rawKindOwner,
  kindSuffix as rawKindSuffix,
  kindTintClass as rawKindTintClass,
  linkGroupOf as rawLinkGroupOf,
  memberRank as rawMemberRank,
  modesFor as rawModesFor,
  openModeFor as rawOpenModeFor,
  openingTab as rawOpeningTab,
  segmentsFor as rawSegmentsFor,
} from "../pkg/wf_wasm.js";
import type {
  DocumentMode,
  KindDocument,
  KindOwner,
  LinkGroup,
  StatusSegment,
  TabRef,
  TreeNodeKind,
} from "./bindings.js";

/** Every kind the explorer can show, the grouping `folder` last. */
export function kindNames(): readonly TreeNodeKind[] {
  return rawKindNames();
}

export function kindIcon(kind: string): string {
  return rawKindIcon(kind);
}

export function isDocumentKind(kind: string): boolean {
  return rawIsDocumentKind(kind);
}

export function hasPdfView(kind: string): boolean {
  return rawHasPdfView(kind);
}

export function hasInkView(kind: string): boolean {
  return rawHasInkView(kind);
}

export function hasLazyBody(kind: string): boolean {
  return rawHasLazyBody(kind);
}

export function isCreatableKind(kind: string): boolean {
  return rawIsCreatableKind(kind);
}

export function kindOwner(kind: string): KindOwner {
  return rawKindOwner(kind);
}

/** Papers before notes inside a reading list. Unknown kinds sort last. */
export function memberRank(kind: string): number {
  // Rust's "no rank" is i32::MAX; callers have always seen Number.MAX_SAFE_INTEGER.
  const rank = rawMemberRank(kind);
  return rank === 2147483647 ? Number.MAX_SAFE_INTEGER : rank;
}

export function linkGroupOf(kind: string): LinkGroup | null {
  return rawLinkGroupOf(kind);
}

export function kindTintClass(kind: string): string | null {
  return rawKindTintClass(kind);
}

/** The tint class for a row's icon; an open folder is accent, a closed one untinted. */
export function kindIconClass(kind: string, open = false): string | null {
  return rawKindIconClass(kind, open);
}

export function kindSuffix(kind: string): string | null {
  return rawKindSuffix(kind);
}

export function documentSuffix(kind: string): string {
  return rawDocumentSuffix(kind);
}

export function modesFor(kind: string): readonly DocumentMode[] {
  return rawModesFor(kind);
}

export function defaultModeFor(kind: string): DocumentMode {
  return rawDefaultModeFor(kind);
}

/** The mode an existing document opens in: an ink note's body opens on Ink. */
export function openModeFor(kind: string, body: string): DocumentMode {
  return rawOpenModeFor(kind, body);
}

/** The tab that opens a document; an absent body reads as empty. */
export function openingTab(kind: string, id: string, body: string | undefined): TabRef {
  return rawOpeningTab(kind, id, body);
}

export function documentKind(kind: string): KindDocument {
  return rawDocumentKind(kind);
}

export function segmentsFor(kind: string): readonly StatusSegment[] {
  return rawSegmentsFor(kind);
}
