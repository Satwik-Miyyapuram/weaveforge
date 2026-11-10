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
  memberNameMap as rawMemberNameMap,
  sharedItem as rawSharedItem,
  sharedItemHref as rawSharedItemHref,
  sharedItemTypeLabel as rawSharedItemTypeLabel,
  sharedPaperAnnotationSummary as rawSharedPaperAnnotationSummary,
  sharedResourceHref as rawSharedResourceHref,
  shareLinkFromRow as rawShareLinkFromRow,
  sharedReadPlan as rawSharedReadPlan,
  shareTargets as rawShareTargets,
  shareableTypes as rawShareableTypes,
  crdtEditableShareTypes as rawCrdtEditableShareTypes,
  shareLinkDefaultTtlDays as rawShareLinkDefaultTtlDays,
} from "../pkg/wf_wasm.js";
import type {
  Comment as CommentRecord,
  CommentRow as CommentRowInput,
  MemberName,
  MemberNameSource,
  NewCommentInput,
  NewShareInput,
  Share as ShareRecord,
  ShareGrant as Share,
  ShareRow as ShareRowInput,
  ShareableType,
  SharedItem as SharedItemRecord,
  SharedPaperAnnotationSummary,
  SharedReadPlan,
  SharedSource as SharedSourceInput,
  ShareLink as ShareLinkBinding,
  ShareLinkRow as ShareLinkRowInput,
  ShareTargets,
} from "./bindings.js";

export type {
  CommentRecord,
  CommentRowInput,
  ShareRecord,
  ShareRowInput,
  SharedItemRecord,
  SharedSourceInput,
};

/** Every type a share can cover (Rust `SHAREABLE_TYPES`). Read at call time; the wasm module must be loaded. */
export function shareableTypes(): readonly ShareableType[] {
  return rawShareableTypes() as readonly ShareableType[];
}

/** Share types that support collaborative editing (Rust `CRDT_EDITABLE_SHARE_TYPES`). */
export function crdtEditableShareTypes(): readonly ShareableType[] {
  return rawCrdtEditableShareTypes() as readonly ShareableType[];
}

/** Days a new view link lives by default (Rust `SHARE_LINK_DEFAULT_TTL_DAYS`). */
export function shareLinkDefaultTtlDays(): number {
  return rawShareLinkDefaultTtlDays();
}

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
  if (input.recipientId && !shareableTypes().includes(input.resourceType)) {
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

/** Map a share-link row to the app's link (Rust `share_link_from_row`). Links are view only. */
export function shareLinkFromRow(
  row: ShareLinkRowInput,
): Omit<ShareLinkBinding, "access"> & { access: "view" } {
  return rawShareLinkFromRow(row) as Omit<ShareLinkBinding, "access"> & { access: "view" };
}

/** The table, columns and PostgREST filter for one shared read; `null` when there is nothing to read (Rust `shared_read_plan`). */
export function sharedReadPlan(
  kind: ShareableType,
  ids: readonly string[],
  owners: readonly string[],
): SharedReadPlan | null {
  return rawSharedReadPlan(kind, [...ids], [...owners]) as SharedReadPlan | null;
}

/** Split one type's grants into per-item ids and blanket owners (Rust `share_targets`). */
export function shareTargets(shares: readonly ShareRecord[], kind: ShareableType): ShareTargets {
  return rawShareTargets([...shares], kind) as ShareTargets;
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

/** Display name per member id: full name, else email, else `"Member"` (Rust `member_name_map`). */
export function memberNameMap(members: readonly MemberNameSource[]): Map<string, string> {
  const names = rawMemberNameMap([...members]) as MemberName[];
  return new Map(names.map((m) => [m.id, m.name]));
}

/** Route to a resource of a shareable type (Rust `shared_resource_href`). */
export function sharedResourceHref(resourceType: ShareableType, resourceId: string): string {
  return rawSharedResourceHref(resourceType, resourceId);
}

/** Route for a shared item (Rust `shared_item_href`). */
export function sharedItemHref(item: SharedItemRecord): string {
  return rawSharedItemHref(item);
}

/** Lowercase type label for a shared item; a note for a vault page (Rust `shared_item_type_label`). */
export function sharedItemTypeLabel(kind: ShareableType): string {
  return rawSharedItemTypeLabel(kind);
}

/** Count and up to three sample texts of a paper's Zotero annotations, notes excluded (Rust `shared_paper_annotation_summary`). */
export function sharedPaperAnnotationSummary(metadata: Record<string, unknown> | undefined): SharedPaperAnnotationSummary {
  return rawSharedPaperAnnotationSummary(metadata ?? null) as SharedPaperAnnotationSummary;
}
