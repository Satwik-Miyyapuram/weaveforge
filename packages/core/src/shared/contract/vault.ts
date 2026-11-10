/** Vault page types and Rust function signatures. */
import type { Identifiable } from "../repository.js";
import type { Clock, IdGenerator } from "../clock.js";

// ---- Vault page types (Rust-owned; hand-declared mirrors of the wf-bindings shapes) ----

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
 * The card/tree projection of a page, as `listSummaries()` returns it. It has no
 * `body` field, so a summary cannot be passed where a full page is expected: the
 * write path would otherwise persist `body: ""` over a real note body.
 */
export interface VaultPageSummary extends Identifiable {
  id: string;
  title: string;
  /** Short body prefix for note cards. Absent on a full page. */
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
 * A node in the vault's page tree, generic over the projection it carries (a
 * {@link VaultPageSummary} from `listSummaries`/`getTree`, or a full {@link VaultPage}).
 */
export interface VaultPageTreeNode<P = VaultPage> {
  page: P;
  children: VaultPageTreeNode<P>[];
}

/** A parsed `[[wikilink]]`. `target` is the linked note/paper title (may be empty for `[[#heading]]`). */
export interface WikilinkRef {
  target: string;
  alias?: string;
  heading?: string;
  block?: string;
  /** The full matched text, e.g. `[[Note#Heading|alias]]`. */
  raw: string;
  /** Where `raw` starts in the body it was read from, and how long it is. Absent on refs built by hand. */
  index?: number;
  length?: number;
}

export interface ParsedFrontmatter {
  body: string;
  tags: string[];
  /** `aliases:` values, whole (multi-word names stay one entry). */
  aliases: string[];
}

/** Signatures of the vault page functions the Rust core (wf-wasm) provides. */
export interface VaultPageFns {
  createVaultPage(input: NewVaultPageInput, deps: { clock: Clock; ids: IdGenerator }): VaultPage;
  /** Build a nested page tree from a flat list (pure). */
  buildPageTree<P extends { id: string; title: string; parentId?: string; sortOrder: number }>(pages: readonly P[]): VaultPageTreeNode<P>[];
  /** Read `Target`, `Target|alias`, `Target#Heading` or `Target#^block`: the inside of one `[[...]]`. */
  parseWikilinkInner(inner: string, raw: string): WikilinkRef | null;
  /** Extracts `[[wikilinks]]` from a note body. Links inside code are ignored. Offsets are into `body`. */
  extractWikilinks(body?: string): WikilinkRef[];
  /** Normalizes a title for case-insensitive wikilink resolution + uniqueness. */
  normalizeTitleKey(title: string): string;
  /** True if a note body links to the given normalized title via `[[wikilink]]`. */
  bodyLinksTo(body: string | undefined, targetKey: string): boolean;
  /** Strips a leading `--- … ---` YAML frontmatter block and pulls out `tags:`/`aliases:` values. */
  stripFrontmatter(md: string): ParsedFrontmatter;
  /** Returns a title unique (case-insensitive) against `used`, suffixing ` (2)`, ` (3)`, … on collision. Records the chosen key in `used`. */
  uniqueTitle(base: string, used: Set<string>): string;
  vaultImageMarkdown(path: string, alt?: string): string;
  /** Collapse whitespace inside markdown image syntax so wrapped refs still match. */
  normalizeMarkdownImageSyntax(body: string): string;
  /** Truncate a note body for card excerpts without treating it as the full page. */
  vaultBodyPreview(body: string, max?: number): string;
  /** Collect unique vault asset paths referenced in markdown bodies. */
  vaultAssetPathsInBody(body: string): string[];
  /** Prefix embedded vault images use in markdown (`vault:`). */
  vaultImagePrefix(): string;
  /** Max chars kept for note-card previews from `listSummaries` (320). */
  vaultBodyPreviewChars(): number;
}

/** Vault folder and search rules; the TS side owns the walk, reads, realpath and mkdir. */
export interface VaultSearchFns {
  searchMatches(text: string, query: string): string[];
  isSearchFile(path: string): boolean;
  isSkippedDir(path: string): boolean;
  rootVerdict(isDir: boolean, entries: string[], metaDir: string): "notADirectory" | "existing" | "empty" | "notEmpty";
  chooseRoot(verdict: "notADirectory" | "existing" | "empty" | "notEmpty"): "use" | "nest" | "refuse";
  temporaryName(target: string, pid: number, seq: number): string;
  isTemporaryName(name: string): boolean;
}
