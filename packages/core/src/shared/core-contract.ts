/** Data shapes the Rust core takes and returns that the generated bindings do not cover yet. */
import type { Identifiable } from "./parts.js";
import type { ReaderAnnotation } from "../reader/parts.js";
import type { PageTextItem } from "../features/reader/parts.js";
import type { PdfLink } from "../features/reader/analysis/analysis-types.js";

// ---- Sharing types (Rust-owned; hand-declared mirrors of the wf-bindings shapes) ----

/** Every type a share can cover. Mirrors wf-core `ShareableType`. */
export type ShareableType =
  | "milestone"
  | "experiment"
  | "report_section"
  | "reading_list"
  | "paper"
  | "vault_page";

export type ShareAccess = "view" | "comment" | "edit";

export interface Share extends Identifiable {
  id: string;
  /** The sharer. Empty on the client for a new grant — the DB defaults it to auth.uid(). */
  ownerId: string;
  recipientId: string;
  resourceType: ShareableType;
  /** `null` = every resource of this type owned by `ownerId` ("share everything"). */
  resourceId: string | null;
  access: ShareAccess;
  createdAt: string;
}

export interface NewShareInput {
  recipientId: string;
  resourceType: ShareableType;
  resourceId: string | null;
  /** Defaults to "comment". */
  access?: ShareAccess;
}

export interface ShareLink {
  id: string;
  ownerId: string;
  resourceType: ShareableType;
  resourceId: string;
  access: "view";
  expiresAt: string | null;
  createdAt: string;
}

export interface ShareLinkSaveInput {
  id: string;
  ownerId: string;
  resourceType: ShareableType;
  resourceId: string;
  access: "view";
  tokenHash: Uint8Array;
  expiresAt: string | null;
  dekWrap?: Uint8Array | null;
  dekEpoch?: number | null;
}

export interface ResolvedShareLink {
  id: string;
  ownerId: string;
  resourceType: ShareableType;
  resourceId: string;
  access: "view";
  dekWrap: Uint8Array | null;
  dekEpoch: number | null;
}

export interface IShareLinkRepository {
  getById(id: string): Promise<ShareLink | null>;
  listForResource(resourceType: ShareableType, resourceId: string): Promise<ShareLink[]>;
  save(input: ShareLinkSaveInput): Promise<ShareLink>;
  delete(id: string): Promise<void>;
  redeem(tokenHash: Uint8Array): Promise<ResolvedShareLink | null>;
}

/** SHA-256 hash of raw link token bytes (stored server-side). */
export interface IShareLinkTokenHasher {
  hash(token: Uint8Array): Promise<Uint8Array>;
}

/**
 * A passage, as the text itself plus a little context either side (the W3C
 * TextQuoteSelector shape). Mirrors wf-core `CommentAnchor`.
 */
export interface CommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface Comment extends Identifiable {
  id: string;
  /** Empty on the client for a new comment — the DB defaults it to auth.uid(). */
  authorId: string;
  resourceType: string;
  resourceId: string;
  body: string;
  createdAt: string;
  /** The passage the comment is about; absent for a page-level comment or a reply. */
  anchor?: CommentAnchor | null;
  /** The thread root this answers; absent on a root. */
  parentId?: string | null;
  /** When the thread was resolved; set on roots only. */
  resolvedAt?: string | null;
}

export interface NewCommentInput {
  resourceType: string;
  resourceId: string;
  body: string;
  anchor?: CommentAnchor | null;
  parentId?: string | null;
}

/** Personalized PageRank over the wiki graph (Rust wf-core, exposed by wf-wasm). */
export interface PprOptions {
  numWalks?: number;
  maxSteps?: number;
  /** Teleport probability back to the seed. */
  damping?: number;
  /** Injected for deterministic tests; production uses Math.random. */
  rng?: () => number;
}

export interface RelatedNode {
  id: string;
  score: number;
}

/** Passage split for embedding (Rust wf-core, exposed by wf-wasm). */
export interface TextChunk {
  text: string;
  /** Offset in the source, so a hit can point at the passage it matched. */
  start: number;
  end: number;
}

export interface ChunkOptions {
  /** Characters per passage. */
  maxChars?: number;
  /** Characters repeated between neighbours. */
  overlapChars?: number;
  /** Below this a trailing fragment is merged back rather than embedded alone. */
  minChars?: number;
}

/** One undoable step (ink undo stack). A new step is a new branch; see `InkUndoFns`. */
export type InkUndoEntry =
  /** A stroke was created; undo removes it, redo creates it again. */
  | { kind: "create"; annotation: ReaderAnnotation }
  /** A stroke was erased; undo creates it again, redo removes it. */
  | { kind: "remove"; annotation: ReaderAnnotation }
  /** Several marks were deleted together; undo recreates all, redo removes all. */
  | { kind: "removeMany"; annotations: ReaderAnnotation[] }
  /** A mark's paths were rewritten (a stroke joined it, or it was moved). */
  | {
      kind: "anchor";
      id: string;
      before: ReaderAnnotation["anchor"];
      after: ReaderAnnotation["anchor"];
    }
  /** A mark's colour, comment, tags or text changed; each side holds the fields it set. */
  | { kind: "update"; id: string; before: InkUndoPatch; after: InkUndoPatch };

/** The fields an edit can change, as `updateLocal` takes them. */
export type InkUndoPatch = Partial<Pick<ReaderAnnotation, "color" | "comment" | "tags" | "text">>;

export interface InkUndoState {
  undo: readonly InkUndoEntry[];
  redo: readonly InkUndoEntry[];
}

/** One PDF text item, with the optional font metrics the citation code reads. */
export type PdfItem = PageTextItem & { fontAscent?: number; fontDescent?: number };

export interface SearchText {
  text: string;
  starts: number[];
  ends: number[];
}

/** One citation found in the text: a numeric marker or an author-year pair. */
export interface CitationCandidate {
  start: number;
  end: number;
  text: string;
  source: "numeric" | "author-year";
  authors?: string;
  year?: string;
}

/** A viewport command for a navigable key (tagged by `type`). */
export type ReaderKeyboardCommand =
  | { type: "page_delta"; delta: number }
  | { type: "page_home" }
  | { type: "page_end" }
  | { type: "zoom_in" }
  | { type: "zoom_out" }
  | { type: "fit_width" }
  | { type: "rotate" };

/** The keyboard event fields the reader reads. */
export interface ReaderKeyEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True when the event target is an editable field. */
  fromEditable?: boolean;
}

/** A span of page text one link covers. Offsets are into the page-text convention string, trimmed of separators. */
export interface CoveredTextSpan {
  link: PdfLink;
  start: number;
  end: number;
}

/* Net: URL and address checks and fetch limits (Rust url_safety); page titles (Rust page_title). */

/**
 * Which addresses the server is allowed to fetch on a visitor's behalf.
 *
 * Refuse addresses, not URLs: `http://169.254.169.254/` returns cloud instance
 * credentials and `http://127.0.0.1:5432` reaches the database. A name is not an
 * address, so callers resolve the hostname and check every address it returns.
 */

/** Why a URL was refused. Phrased for a person, not a log. */
export type UrlRejection =
  | "not-a-url"
  | "scheme"
  | "credentials"
  | "port"
  | "private-address"
  | "hostname";

export interface UrlCheck {
  ok: boolean;
  reason?: UrlRejection;
}

/** Limits a fetch on the visitor's behalf runs under (Rust `DEFAULT_FETCH_LIMITS`). */
export interface OutboundFetchLimits {
  /** Redirect hops followed. Each one is re-checked. */
  maxRedirects: number;
  /** Bytes read before the response is abandoned. */
  maxBytes: number;
  /** Wall-clock budget for the whole fetch, redirects included. */
  timeoutMs: number;
}

/** The best title a page offers. `suspect` marks a challenge page rather than the article. */
export interface PageTitle {
  title: string;
  /** True when the title looks like a challenge page rather than the article. */
  suspect: boolean;
}

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
