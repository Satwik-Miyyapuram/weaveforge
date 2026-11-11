/**
 * Typed wrappers over the wasm vault page helpers (wf-core `vault::page`). The names and
 * defaults match the `VaultPage` contract in `packages/core/src/shared/core-contract.ts`; the
 * markdown image helpers live in `workspace.ts`.
 */
import {
  bodyLinksTo as rawBodyLinksTo,
  expandEmbeds as rawExpandEmbeds,
  replaceVaultAssetPaths as rawReplaceVaultAssetPaths,
  vaultBodyPreview as rawBodyPreview,
  vaultBodyPreviewChars as rawBodyPreviewChars,
  extractWikilinks as rawExtractWikilinks,
  normalizeTitleKey as rawNormalizeTitleKey,
  noteBacklinks as rawNoteBacklinks,
  scopeNoteIndices as rawScopeNoteIndices,
  uniqueTitle as rawUniqueTitle,
  vaultTitleOrBodyFilter as rawTitleOrBodyFilter,
} from "../pkg/wf_wasm.js";
import type {
  ParsedFrontmatter,
  WikilinkRef,
} from "./bindings.js";

export {
  noteTags,
} from "../pkg/wf_wasm.js";

export {
  embedTitles,
  isMissingBodyPreviewColumn,
  normalizeTitleKey,
  parseWikilinkInner,
  stripFrontmatter,
  vaultAssetPathsInBody,
  vaultImageMarkdown,
  vaultImagePrefix,
  vaultTitleLikePattern,
} from "../pkg/wf_wasm.js";

export type { ParsedFrontmatter, WikilinkRef };

/** Max chars kept for note-card previews from `listSummaries`. */
export function vaultBodyPreviewChars(): number {
  return rawBodyPreviewChars();
}

export function extractWikilinks(body?: string): WikilinkRef[] {
  if (!body) return [];
  return rawExtractWikilinks(body) as WikilinkRef[];
}

export function bodyLinksTo(body: string | undefined, targetKey: string): boolean {
  if (!body) return false;
  return rawBodyLinksTo(body, targetKey);
}

/** A title unique against `used` (normalized keys). Records the chosen key in `used`, as TS does. */
export function uniqueTitle(base: string, used: Set<string>): string {
  const title = rawUniqueTitle(base, [...used]);
  used.add(rawNormalizeTitleKey(title));
  return title;
}

export function vaultBodyPreview(body: string, max = vaultBodyPreviewChars()): string {
  if (!body) return "";
  return rawBodyPreview(body, max);
}

/** `body` with each embed whose title is in `resolved` replaced by that note's body as a callout. */
export function expandEmbeds(body: string, resolved: ReadonlyMap<string, string>): string {
  return rawExpandEmbeds(body, [...resolved.keys()], [...resolved.values()]);
}

/** `body` with each `vault:{oldPath}` rewritten to `vault:{newPath}`, in order. */
export function replaceVaultAssetPaths(
  body: string,
  rewrites: readonly { oldPath: string; newPath: string }[],
): string {
  return rawReplaceVaultAssetPaths(
    body,
    rewrites.map((r) => r.oldPath),
    rewrites.map((r) => r.newPath),
  );
}

/** The other notes whose body links to `selectedId`'s title, as `{ id, title }`. */
export function noteBacklinks(
  notes: readonly unknown[],
  selectedId?: string,
): { id: string; title: string }[] {
  return rawNoteBacklinks(notes, selectedId);
}

/** Positions of the notes kept by a list and tag filter. An empty filter keeps everything. */
export function scopeNoteIndices(
  notes: readonly unknown[],
  listFilter: readonly string[],
  tagFilter: readonly string[],
  membership: Readonly<Record<string, readonly string[]>>,
): number[] {
  return rawScopeNoteIndices(notes, [...listFilter], [...tagFilter], membership);
}

/**
 * The PostgREST `or` filter for a case-insensitive title or body search, or `undefined`
 * for an empty query (no filter).
 */
export function vaultTitleOrBodyFilter(query: string): string | undefined {
  return rawTitleOrBodyFilter(query) ?? undefined;
}

