/**
 * Typed wrappers over the wasm vault page helpers (wf-core `vault::page`). The names and
 * defaults match the `VaultPage` contract in `packages/core/src/shared/core-contract.ts`; the
 * markdown image helpers live in `workspace.ts`.
 */
import {
  vaultAssetPathsInBody as rawAssetPathsInBody,
  bodyLinksTo as rawBodyLinksTo,
  embedTitles as rawEmbedTitles,
  expandEmbeds as rawExpandEmbeds,
  replaceVaultAssetPaths as rawReplaceVaultAssetPaths,
  vaultBodyPreview as rawBodyPreview,
  vaultBodyPreviewChars as rawBodyPreviewChars,
  vaultImagePrefix as rawImagePrefix,
  extractWikilinks as rawExtractWikilinks,
  vaultImageMarkdown as rawImageMarkdown,
  normalizeTitleKey as rawNormalizeTitleKey,
  noteBacklinks as rawNoteBacklinks,
  noteTags as rawNoteTags,
  parseWikilinkInner as rawParseWikilinkInner,
  scopeNoteIndices as rawScopeNoteIndices,
  stripFrontmatter as rawStripFrontmatter,
  uniqueTitle as rawUniqueTitle,
  vaultTitleOrBodyFilter as rawTitleOrBodyFilter,
  vaultTitleLikePattern as rawTitleLikePattern,
  isMissingBodyPreviewColumn as rawIsMissingBodyPreviewColumn,
} from "../pkg/wf_wasm.js";
import type { ParsedFrontmatter, WikilinkRef } from "./bindings.js";

export type { ParsedFrontmatter, WikilinkRef };

/** Prefix embedded vault images use in markdown: `![](vault:userId/pageId/file.png)`. */
export function vaultImagePrefix(): string {
  return rawImagePrefix();
}

/** Max chars kept for note-card previews from `listSummaries`. */
export function vaultBodyPreviewChars(): number {
  return rawBodyPreviewChars();
}

export function parseWikilinkInner(inner: string, raw: string): WikilinkRef | null {
  return rawParseWikilinkInner(inner, raw) as WikilinkRef;
}

export function extractWikilinks(body?: string): WikilinkRef[] {
  if (!body) return [];
  return rawExtractWikilinks(body) as WikilinkRef[];
}

export function normalizeTitleKey(title: string): string {
  return rawNormalizeTitleKey(title);
}

export function bodyLinksTo(body: string | undefined, targetKey: string): boolean {
  if (!body) return false;
  return rawBodyLinksTo(body, targetKey);
}

export function stripFrontmatter(md: string): ParsedFrontmatter {
  return rawStripFrontmatter(md) as ParsedFrontmatter;
}

/** A title unique against `used` (normalized keys). Records the chosen key in `used`, as TS does. */
export function uniqueTitle(base: string, used: Set<string>): string {
  const title = rawUniqueTitle(base, [...used]);
  used.add(rawNormalizeTitleKey(title));
  return title;
}

export function vaultImageMarkdown(path: string, alt = "image"): string {
  return rawImageMarkdown(path, alt);
}

export function vaultAssetPathsInBody(body: string): string[] {
  return rawAssetPathsInBody(body);
}

export function vaultBodyPreview(body: string, max = vaultBodyPreviewChars()): string {
  if (!body) return "";
  return rawBodyPreview(body, max);
}

/** The trimmed title of each `![[...]]` embed in `body`, in order (repeats kept). */
export function embedTitles(body: string): string[] {
  return rawEmbedTitles(body);
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

/** Every hashtag used across `notes`, distinct and sorted by UTF-16 order. */
export function noteTags(notes: readonly unknown[]): string[] {
  return rawNoteTags(notes);
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

/** The ILIKE pattern that narrows candidates for a normalised title key. */
export function vaultTitleLikePattern(key: string): string {
  return rawTitleLikePattern(key);
}

/** True when a PostgREST error means the `body_preview` column is not migrated yet. */
export function isMissingBodyPreviewColumn(message: string | undefined, code: string | undefined): boolean {
  return rawIsMissingBodyPreviewColumn(message, code);
}
