/**
 * Vault domain model — Obsidian-like markdown pages in a nested tree.
 * Pure, no I/O, no SDK imports.
 */

import { markdownImage } from "../../../shared/markdown-image.js";
import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

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

export interface VaultPageFilter {
  /** Use `null` to select only top-level pages. */
  parentId?: string | null;
  /** Case-insensitive substring match against title or body. */
  query?: string;
}

export interface VaultPageTreeNode {
  page: VaultPage;
  children: VaultPageTreeNode[];
}

export class VaultPageValidationError extends Error {
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

/** Build a nested page tree from a flat list (pure). */
export function buildPageTree(pages: readonly VaultPage[]): VaultPageTreeNode[] {
  const nodes = new Map<string, VaultPageTreeNode>();
  for (const page of pages) {
    nodes.set(page.id, { page, children: [] });
  }
  const roots: VaultPageTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.page.parentId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (list: VaultPageTreeNode[]) => {
    list.sort(
      (a, b) =>
        a.page.sortOrder - b.page.sortOrder ||
        a.page.title.localeCompare(b.page.title),
    );
    for (const n of list) sortNodes(n.children);
  };
  sortNodes(roots);
  return roots;
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
  const paths = new Set<string>();
  const normalized = normalizeMarkdownImageSyntax(body);
  const re = /!\[[^\]]*\]\(vault:([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    paths.add(m[1]!);
  }
  return [...paths];
}
