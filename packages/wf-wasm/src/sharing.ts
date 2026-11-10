/**
 * Sharing and comment domain helpers (Rust `sharing`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/sharing/domain/share.ts and comment.ts.
 */
import {
  commentFromRow as rawCommentFromRow,
  decodeShareLinkToken as rawDecodeShareLinkToken,
  isBlanketShare as rawIsBlanketShare,
  normalizeCommentInput as rawNormalizeCommentInput,
  normalizeShareInput as rawNormalizeShareInput,
  shareFromRow as rawShareFromRow,
  shareSupportsEditAccess as rawShareSupportsEditAccess,
  memberNameMap as rawMemberNameMap,
  sharedItem as rawSharedItem,
  sharedItemHref as rawSharedItemHref,
  sharedPaperAnnotationSummary as rawSharedPaperAnnotationSummary,
  shareLinkFromRow as rawShareLinkFromRow,
  sharedReadPlan as rawSharedReadPlan,
  shareTargets as rawShareTargets,
  shareableTypes as rawShareableTypes,
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

export {
  crdtEditableShareTypes,
  shareAllowsComment,
  shareAllowsEdit,
  shareCoversResource,
} from "../pkg/wf_wasm.js";

export {
  encodeShareLinkToken,
  shareLinkDefaultTtlDays,
  sharedItemTypeLabel,
  sharedResourceHref,
} from "../pkg/wf_wasm.js";

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

/** Route for a shared item (Rust `shared_item_href`). */
export function sharedItemHref(item: SharedItemRecord): string {
  return rawSharedItemHref(item);
}

/** Count and up to three sample texts of a paper's Zotero annotations, notes excluded (Rust `shared_paper_annotation_summary`). */
export function sharedPaperAnnotationSummary(metadata: Record<string, unknown> | undefined): SharedPaperAnnotationSummary {
  return rawSharedPaperAnnotationSummary(metadata ?? null) as SharedPaperAnnotationSummary;
}
