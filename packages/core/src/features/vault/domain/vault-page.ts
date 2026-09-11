/**
 * Vault domain model — Obsidian-like markdown pages in a nested tree.
 * Pure, no I/O, no SDK imports.
 */

import { imagePathsInBody, markdownImage } from "../../../shared/markdown-image.js";
import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { buildTree } from "../../../shared/tree.js";
import { ValidationError } from "../../../shared/errors.js";

export interface VaultPage extends Identifiable {
  id: string;
  title: string;
  /** Markdown body; may reference vault assets via `vault:{path}` image URLs. */
  body: string;
  /**
   * Short body prefix for note cards when `listSummaries` omits full `body`.
   * Keep empty/`undefined` on full pages so hydrate-on-open still fetches.
   */
  bodyPreview?: string;
  /** Parent page for nesting; undefined = top level. */
  parentId?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewVaultPageInput {
  title: string;
  body?: string;
  parentId?: string;
  sortOrder?: number;
}

/**
 * The card/tree projection of a page — what `listSummaries()` returns.
 *
 * Deliberately **not** a `VaultPage` with holes: it has no `body` field at all,
 * so a summary cannot be passed where a full page is expected. That is the
 * point. The screen used to concatenate these with full `getById` rows into one
 * `VaultPage[]`, and `toRow` then persisted `body: p.body ?? ""` — silently
 * wiping the note body of every page whose card the user edited (review-2 F6).
 * With this type the write path does not compile, instead of relying on a
 * screen-level hydration guard to remember.
 *
 * Everything the card/tree actually paints is here; the full text arrives via
 * {@link VaultPage} from `getById` when a page is opened.
 */
export interface VaultPageSummary {
  id: string;
  title: string;
  /**
   * Short body prefix for note cards. Absent on a full page, so its presence
   * tells a reader which projection it holds.
   */
  bodyPreview?: string;
  /** Parent page for nesting; undefined = top level. */
  parentId?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface VaultPageFilter {
  /** Use `null` to select only top-level pages. */
  parentId?: string | null;
  /** Case-insensitive substring match against title or body. */
  query?: string;
}

/**
 * A node in the vault's page tree.
 *
 * Generic over the page projection it carries (review-2 F6). The tree is built
 * from the *summary* columns — the card/tree paints a title and a preview, never
 * a body — so `page` is a {@link VaultPageSummary} wherever the tree comes from
 * `listSummaries`/`getTree`, and a full {@link VaultPage} only when it was built
 * from rows that were actually read in full. Defaulting `P` to `VaultPage` keeps
 * the meaning of a bare `VaultPageTreeNode` unchanged for code that really does
 * hold full pages.
 */
export interface VaultPageTreeNode<P = VaultPage> {
  page: P;
  children: VaultPageTreeNode<P>[];
}

export class VaultPageValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "VaultPageValidationError";
  }
}

export function createVaultPage(
  input: NewVaultPageInput,
  deps: { clock: Clock; ids: IdGenerator },
): VaultPage {
  const title = input.title?.trim();
  if (!title) {
    throw new VaultPageValidationError("Page title is required.");
  }
  const now = deps.clock.nowIso();
  return {
    id: deps.ids.newId(),
    title,
    body: input.body ?? "",
    parentId: input.parentId,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build a nested page tree from a flat list (pure).
 *
 * Generic over the projection it is handed, so a caller holding summaries gets a
 * tree of summaries rather than a tree that claims every node is a full page
 * (review-2 F6). The constraints are the fields the tree is actually built from,
 * which both {@link VaultPage} and {@link VaultPageSummary} satisfy.
 */
export function buildPageTree<
  P extends { id: string; title: string; parentId?: string; sortOrder: number },
>(pages: readonly P[]): VaultPageTreeNode<P>[] {
  return buildTree(pages, {
    id: (page) => page.id,
    parentId: (page) => page.parentId,
    node: (page) => ({ page, children: [] }),
    compare: (a, b) =>
      a.page.sortOrder - b.page.sortOrder ||
      a.page.title.localeCompare(b.page.title),
  });
}

/** A parsed `[[wikilink]]`. `target` is the linked note/paper title (may be
 *  empty for a same-note `[[#heading]]`). */
export interface WikilinkRef {
  target: string;
  alias?: string;
  heading?: string;
  block?: string;
  /** The full matched text, e.g. `[[Note#Heading|alias]]`. */
  raw: string;
}

/** Blank out code fences and inline code so links inside code aren't parsed. */
function maskCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

function parseWikilinkInner(inner: string, raw: string): WikilinkRef | null {
  const pipe = inner.indexOf("|");
  const link = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim() || undefined;
  const hash = link.indexOf("#");
  if (hash === -1) return { target: link, alias, raw };
  const target = link.slice(0, hash).trim();
  const rest = link.slice(hash + 1);
  if (rest.startsWith("^")) return { target, alias, block: rest.slice(1).trim() || undefined, raw };
  return { target, alias, heading: rest.trim() || undefined, raw };
}

/**
 * Extracts `[[wikilinks]]` from a note body: `[[Target]]`, `[[Target|alias]]`,
 * `[[Target#Heading]]`, `[[Target#^block]]`. Links inside code are ignored.
 * Pure — resolution to ids happens in the UI against the note/paper title maps.
 */
export function extractWikilinks(body?: string): WikilinkRef[] {
  if (!body) return [];
  const masked = maskCode(body);
  const re = /\[\[([^\[\]\n]+?)\]\]/g;
  const out: WikilinkRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const ref = parseWikilinkInner(m[1]!, m[0]!);
    if (ref) out.push(ref);
  }
  return out;
}

/** Normalizes a title for case-insensitive wikilink resolution + uniqueness. */
export function normalizeTitleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True if a note body links to the given normalized title via `[[wikilink]]`. */
export function bodyLinksTo(body: string | undefined, targetKey: string): boolean {
  if (!body) return false;
  return extractWikilinks(body).some((ref) => normalizeTitleKey(ref.target) === targetKey);
}

export interface ParsedFrontmatter {
  body: string;
  tags: string[];
}

/**
 * Strips a leading `--- … ---` YAML frontmatter block (Obsidian/Notion export)
 * and pulls out `tags:`/`aliases:` values — inline `[a, b]`, csv, or a `- item`
 * block. Not a full YAML parser; just enough to preserve tags on import.
 */
export function stripFrontmatter(md: string): ParsedFrontmatter {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!match) return { body: md, tags: [] };
  const body = md.slice(match[0].length);
  const lines = match[1]!.split(/\r?\n/);
  const tags = new Set<string>();
  const collect = (raw: string) =>
    raw
      .split(/[,\s]+/)
      .map((s) => s.replace(/^["'#]+|["']+$/g, "").trim())
      .filter(Boolean)
      .forEach((t) => tags.add(t));
  for (let i = 0; i < lines.length; i += 1) {
    const inline = /^(tags|aliases):\s*(.*)$/i.exec(lines[i]!);
    if (!inline) continue;
    let rest = inline[2]!.trim();
    if (rest.startsWith("[")) rest = rest.replace(/^\[|\]$/g, "");
    if (rest) collect(rest);
    for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]!); j += 1) {
      collect(lines[j]!.replace(/^\s*-\s+/, ""));
      i = j;
    }
  }
  return { body, tags: [...tags] };
}

/**
 * Returns a title unique (case-insensitive) against `used`, suffixing ` (2)`,
 * ` (3)`, … on collision. Records the chosen key in `used`.
 */
export function uniqueTitle(base: string, used: Set<string>): string {
  const trimmed = base.trim() || "Untitled";
  let title = trimmed;
  let key = normalizeTitleKey(title);
  let n = 2;
  while (used.has(key)) {
    title = `${trimmed} (${n})`;
    key = normalizeTitleKey(title);
    n += 1;
  }
  used.add(key);
  return title;
}

/** Prefix embedded vault images use in markdown: `![](vault:userId/pageId/file.png)`. */
export const VAULT_IMAGE_PREFIX = "vault:";

export function vaultImageMarkdown(path: string, alt = "image"): string {
  return markdownImage(`${VAULT_IMAGE_PREFIX}${path}`, alt);
}

/** Collapse whitespace inside markdown image syntax so wrapped refs still match. */
export function normalizeMarkdownImageSyntax(body: string): string {
  return body.replace(
    /!\[([^\]]*)\]\s*\(\s*((?:blob|vault|paperimg|reportimg):[^)\s]+|https?:\/\/[^)\s]+)\s*\)/g,
    "![$1]($2)",
  );
}

/** Max chars kept for note-card previews from `listSummaries`. */
export const VAULT_BODY_PREVIEW_CHARS = 320;

/** Truncate a note body for card excerpts without treating it as the full page. */
export function vaultBodyPreview(body: string, max = VAULT_BODY_PREVIEW_CHARS): string {
  if (!body) return "";
  return body.length > max ? body.slice(0, max) : body;
}

/** Collect unique vault asset paths referenced in markdown bodies. */
export function vaultAssetPathsInBody(body: string): string[] {
  return imagePathsInBody(body, VAULT_IMAGE_PREFIX, normalizeMarkdownImageSyntax);
}
