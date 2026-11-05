/**
 * Typed wrappers over the wasm vault page helpers (wf-core `vault::page`). The names and
 * defaults match `packages/core/src/features/vault/domain/vault-page.ts`; the markdown
 * image helpers live in `workspace.ts`.
 */
import {
  vaultAssetPathsInBody as rawAssetPathsInBody,
  bodyLinksTo as rawBodyLinksTo,
  vaultBodyPreview as rawBodyPreview,
  extractWikilinks as rawExtractWikilinks,
  vaultImageMarkdown as rawImageMarkdown,
  normalizeTitleKey as rawNormalizeTitleKey,
  parseWikilinkInner as rawParseWikilinkInner,
  stripFrontmatter as rawStripFrontmatter,
  uniqueTitle as rawUniqueTitle,
} from "../pkg/wf_wasm.js";
import type { ParsedFrontmatter, WikilinkRef } from "./bindings.js";

export type { ParsedFrontmatter, WikilinkRef };

export const VAULT_IMAGE_PREFIX = "vault:";
export const VAULT_BODY_PREVIEW_CHARS = 320;

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

export function vaultBodyPreview(body: string, max = VAULT_BODY_PREVIEW_CHARS): string {
  if (!body) return "";
  return rawBodyPreview(body, max);
}
