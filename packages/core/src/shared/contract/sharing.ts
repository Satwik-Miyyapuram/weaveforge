/** Sharing types and Rust function signatures (share, comment, share link). */
import type { Identifiable } from "../repository.js";

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

/** Signatures of the share functions that live in the Rust core (wf-wasm). */
export interface ShareFns {
  /** Whether a share grant covers every resource of a type (resourceId is null). */
  isBlanketShare(resourceId: string | null): boolean;
  shareSupportsEditAccess(resourceType: ShareableType, resourceId: string | null): boolean;
  /** Whether a share grant covers a specific resource (including blanket grants). */
  shareCoversResource(share: Pick<Share, "resourceType" | "resourceId" | "ownerId">, resourceType: ShareableType, resourceId: string, ownerId: string): boolean;
  /** Whether a share grant allows commenting on a specific resource. */
  shareAllowsComment(share: Pick<Share, "resourceType" | "resourceId" | "ownerId" | "access">, resourceType: ShareableType, resourceId: string, ownerId: string): boolean;
  /** Whether a share grant allows collaborative editing (CRDT path). */
  shareAllowsEdit(share: Pick<Share, "resourceType" | "resourceId" | "ownerId" | "access">, resourceType: ShareableType, resourceId: string, ownerId: string): boolean;
  /** Normalize + validate a grant request (pure). */
  normalizeShareInput(input: NewShareInput): Required<NewShareInput>;
}

/** Constants and the default expiry, read from Rust at call time (wf-wasm getters). */
export interface SharingConstantsFns {
  shareableTypes(): readonly ShareableType[];
  crdtEditableShareTypes(): readonly ShareableType[];
  shareLinkDefaultTtlDays(): number;
  /** The expiry `SHARE_LINK_DEFAULT_TTL_DAYS` after `nowMs`, as ISO-8601 UTC. */
  defaultShareLinkExpiresAt(nowMs: number): string;
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

/** Signatures of the share-link token functions that live in the Rust core (wf-wasm). */
export interface ShareLinkTokenFns {
  /** Base64url token for URL query param `?t=`. */
  encodeShareLinkToken(token: Uint8Array): string;
  /** Bytes of a URL token; throws on one that is not base64. */
  decodeShareLinkToken(encoded: string): Uint8Array;
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

/** Signatures of the comment functions that live in the Rust core (wf-wasm). */
export interface CommentFns {
  normalizeCommentInput(input: NewCommentInput): NewCommentInput;
}
