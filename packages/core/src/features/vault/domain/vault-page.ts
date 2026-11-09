/** Types for vault-page. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { ValidationError } from "../../../shared/errors.js";

/**
 * A full page: the summary fields plus the body. Keep `bodyPreview`
 * empty/`undefined` on full pages so hydrate-on-open still fetches.
 */
export interface VaultPage extends VaultPageSummary {
  /** Markdown body; may reference vault assets via `vault:{path}` image URLs. */
  body: string;
}

export interface NewVaultPageInput {
  title: string;
  body?: string;
  parentId?: string;
  /** Make a folder rather than a note. */
  folder?: boolean;
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
export interface VaultPageSummary extends Identifiable {
  id: string;
  title: string;
  /**
   * Short body prefix for note cards. Absent on a full page, so its presence
   * tells a reader which projection it holds.
   */
  bodyPreview?: string;
  /** Parent page for nesting; undefined = top level. */
  parentId?: string;
  /** The owner pinned it; the Notes screen lists pinned notes first. */
  pinned?: boolean;
  /** Made as a folder: it holds notes and folders, and is not opened as a note. */
  folder?: boolean;
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

/** A parsed `[[wikilink]]`. `target` is the linked note/paper title (may be
 *  empty for a same-note `[[#heading]]`). */
export interface WikilinkRef {
  target: string;
  alias?: string;
  heading?: string;
  block?: string;
  /** The full matched text, e.g. `[[Note#Heading|alias]]`. */
  raw: string;
  /**
   * Where `raw` starts in the body it was read from, and how long it is.
   *
   * Carried rather than recomputed: a caller that wants to quote the link's
   * neighbourhood cannot search the body for `raw` without landing on an
   * earlier identical link. Absent on refs built by hand.
   */
  index?: number;
  length?: number;
}

export { wikilinkPattern } from "./wikilink-pattern.js";

export interface ParsedFrontmatter {
  body: string;
  tags: string[];
  /** `aliases:` values, whole (multi-word names stay one entry). */
  aliases: string[];
}

/** Prefix embedded vault images use in markdown: `![](vault:userId/pageId/file.png)`. */
export const VAULT_IMAGE_PREFIX = "vault:";

/** Max chars kept for note-card previews from `listSummaries`. */
export const VAULT_BODY_PREVIEW_CHARS = 320;

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface VaultPageFns {
  createVaultPage(input: NewVaultPageInput, deps: { clock: Clock; ids: IdGenerator }): VaultPage;
  /**
 * Build a nested page tree from a flat list (pure).
 *
 * Generic over the projection it is handed, so a caller holding summaries gets a
 * tree of summaries rather than a tree that claims every node is a full page
 * (review-2 F6). The constraints are the fields the tree is actually built from,
 * which both {@link VaultPage} and {@link VaultPageSummary} satisfy.
 */
  buildPageTree<P extends { id: string; title: string; parentId?: string; sortOrder: number }>(pages: readonly P[]): VaultPageTreeNode<P>[];
  /** Read `Target`, `Target|alias`, `Target#Heading` or `Target#^block`: the inside of one `[[...]]`. */
  parseWikilinkInner(inner: string, raw: string): WikilinkRef | null;
  /**
 * Extracts `[[wikilinks]]` from a note body: `[[Target]]`, `[[Target|alias]]`,
 * `[[Target#Heading]]`, `[[Target#^block]]`. Links inside code are ignored.
 * Pure — resolution to ids happens in the UI against the note/paper title maps.
 *
 * `maskCode` blanks code spans to spaces of the same length, so an offset in the
 * masked text is the same offset in `body` — which is what lets `index` be the
 * position in the original.
 */
  extractWikilinks(body?: string): WikilinkRef[];
  /** Normalizes a title for case-insensitive wikilink resolution + uniqueness. */
  normalizeTitleKey(title: string): string;
  /** True if a note body links to the given normalized title via `[[wikilink]]`. */
  bodyLinksTo(body: string | undefined, targetKey: string): boolean;
  /**
 * Strips a leading `--- … ---` YAML frontmatter block (Obsidian/Notion export)
 * and pulls out `tags:`/`aliases:` values — inline `[a, b]`, csv, or a `- item`
 * block. Not a full YAML parser; just enough to preserve tags on import.
 */
  stripFrontmatter(md: string): ParsedFrontmatter;
  /**
 * Returns a title unique (case-insensitive) against `used`, suffixing ` (2)`,
 * ` (3)`, … on collision. Records the chosen key in `used`.
 */
  uniqueTitle(base: string, used: Set<string>): string;
  vaultImageMarkdown(path: string, alt?: string): string;
  /** Collapse whitespace inside markdown image syntax so wrapped refs still match. */
  normalizeMarkdownImageSyntax(body: string): string;
  /** Truncate a note body for card excerpts without treating it as the full page. */
  vaultBodyPreview(body: string, max?: number): string;
  /** Collect unique vault asset paths referenced in markdown bodies. */
  vaultAssetPathsInBody(body: string): string[];
}
