/**
 * Sharing and comment domain helpers (Rust `sharing`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/sharing/domain/share.ts and comment.ts.
 */
import {
  commentFromRow as rawCommentFromRow,
  decodeShareLinkToken as rawDecodeShareLinkToken,
  encodeShareLinkToken as rawEncodeShareLinkToken,
  isBlanketShare as rawIsBlanketShare,
  normalizeCommentInput as rawNormalizeCommentInput,
  normalizeShareInput as rawNormalizeShareInput,
  shareAllowsComment as rawShareAllowsComment,
  shareAllowsEdit as rawShareAllowsEdit,
  shareCoversResource as rawShareCoversResource,
  shareFromRow as rawShareFromRow,
  shareSupportsEditAccess as rawShareSupportsEditAccess,
  sharedItem as rawSharedItem,
} from "../pkg/wf_wasm.js";
import type {
  Comment as CommentRecord,
  CommentRow as CommentRowInput,
  NewCommentInput,
  NewShareInput,
  Share as ShareRecord,
  ShareGrant as Share,
  ShareRow as ShareRowInput,
  ShareableType,
  SharedItem as SharedItemRecord,
  SharedSource as SharedSourceInput,
} from "./bindings.js";

export type {
  CommentRecord,
  CommentRowInput,
  ShareRecord,
  ShareRowInput,
  SharedItemRecord,
  SharedSourceInput,
};

/** Every type a share can cover (TS `SHAREABLE_TYPES`). */
export const SHAREABLE_TYPES: readonly ShareableType[] = [
  "milestone",
  "experiment",
  "report_section",
  "reading_list",
  "paper",
  "vault_page",
];

/** Share types that support collaborative editing (TS `CRDT_EDITABLE_SHARE_TYPES`). */
export const CRDT_EDITABLE_SHARE_TYPES: readonly ShareableType[] = ["vault_page", "report_section"];

/** A thrown validation message becomes an `Error` named like the TS validation class. */
function asError(thrown: unknown, name: string): unknown {
  // Rust rejects with a string or with an unnamed `Error` (serde_wasm_bindgen).
  if (thrown instanceof Error && thrown.name === "Error") {
    thrown.name = name;
    return thrown;
  }
  if (typeof thrown !== "string") return thrown;
  const error = new Error(thrown);
  error.name = name;
  return error;
}

/** Whether a share grant covers every resource of a type (`resourceId` is null). */
export function isBlanketShare(resourceId: string | null): boolean {
  return rawIsBlanketShare(resourceId ?? undefined);
}

/** Share types that support collaborative editing (CRDT path). */
export function shareSupportsEditAccess(
  resourceType: ShareableType,
  resourceId: string | null,
): boolean {
  return rawShareSupportsEditAccess(resourceType, resourceId ?? undefined);
}

/** Whether a share grant covers a specific resource (including blanket grants). */
export function shareCoversResource(
  share: Pick<Share, "resourceType" | "resourceId" | "ownerId">,
  resourceType: ShareableType,
  resourceId: string,
  ownerId: string,
): boolean {
  return rawShareCoversResource(share, resourceType, resourceId, ownerId);
}

/** Whether a share grant allows commenting on a specific resource. */
export function shareAllowsComment(
  share: Pick<Share, "resourceType" | "resourceId" | "ownerId" | "access">,
  resourceType: ShareableType,
  resourceId: string,
  ownerId: string,
): boolean {
  return rawShareAllowsComment(share, resourceType, resourceId, ownerId);
}

/** Whether a share grant allows collaborative editing (CRDT path). */
export function shareAllowsEdit(
  share: Pick<Share, "resourceType" | "resourceId" | "ownerId" | "access">,
  resourceType: ShareableType,
  resourceId: string,
  ownerId: string,
): boolean {
  return rawShareAllowsEdit(share, resourceType, resourceId, ownerId);
}

/** Normalize + validate a grant request (pure). Throws an `Error` with the validation message. */
export function normalizeShareInput(input: NewShareInput): Required<NewShareInput> {
  // An unknown type would fail to deserialize in Rust; report it as the TS rule did.
  if (input.recipientId && !SHAREABLE_TYPES.includes(input.resourceType)) {
    throw asError(`Unknown resource type "${input.resourceType}".`, "ShareValidationError");
  }
  try {
    return rawNormalizeShareInput(input) as Required<NewShareInput>;
  } catch (error) {
    throw asError(error, "ShareValidationError");
  }
}

/** Normalize + validate a comment request. Throws an `Error` with the validation message. */
export function normalizeCommentInput(input: NewCommentInput): NewCommentInput {
  try {
    return rawNormalizeCommentInput(input) as NewCommentInput;
  } catch (error) {
    throw asError(error, "CommentValidationError");
  }
}

/** Base64url (unpadded) form of a share-link token, for the URL's `?t=`. */
export function encodeShareLinkToken(token: Uint8Array): string {
  return rawEncodeShareLinkToken(token);
}

/** Bytes of a share-link token; accepts either base64 alphabet, padded or not. Throws on a mangled token. */
export function decodeShareLinkToken(encoded: string): Uint8Array {
  try {
    return rawDecodeShareLinkToken(encoded);
  } catch (error) {
    throw asError(error, "InvalidCharacterError");
  }
}

/** Map a share row to the domain share (Rust `share_from_row`). */
export function shareFromRow(row: ShareRowInput): ShareRecord {
  return rawShareFromRow(row) as ShareRecord;
}

/** Map a comment row to the domain comment (Rust `comment_from_row`). */
export function commentFromRow(row: CommentRowInput): CommentRecord {
  return rawCommentFromRow(row) as CommentRecord;
}

/** Shape one reader row into a `SharedItem` (Rust `shared_item`). */
export function sharedItem(
  kind: ShareableType,
  row: Record<string, unknown>,
  source: SharedSourceInput,
): SharedItemRecord {
  return rawSharedItem(kind, row, source) as SharedItemRecord;
}
