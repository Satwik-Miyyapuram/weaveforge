/**
 * Sharing and comment domain helpers (Rust `sharing`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/sharing/domain/share.ts and comment.ts.
 */
import {
  decodeShareLinkToken as rawDecodeShareLinkToken,
  normalizeCommentInput as rawNormalizeCommentInput,
  normalizeShareInput as rawNormalizeShareInput,
  memberNameMap as rawMemberNameMap,
  sharedPaperAnnotationSummary as rawSharedPaperAnnotationSummary,
  shareableTypes,
} from "../pkg/wf_wasm.js";
import type {
  Comment as CommentRecord,
  CommentRow as CommentRowInput,
  MemberName,
  MemberNameSource,
  NewCommentInput,
  NewShareInput,
  Share as ShareRecord,
  ShareRow as ShareRowInput,
  SharedItem as SharedItemRecord,
  SharedPaperAnnotationSummary,
  SharedSource as SharedSourceInput,
} from "./bindings.js";

export {
  crdtEditableShareTypes,
  isBlanketShare,
  shareAllowsComment,
  shareAllowsEdit,
  shareCoversResource,
  shareLinkFromRow,
  shareSupportsEditAccess,
  shareTargets,
  shareableTypes,
} from "../pkg/wf_wasm.js";

export {
  commentFromRow,
  encodeShareLinkToken,
  shareFromRow,
  shareLinkDefaultTtlDays,
  sharedItem,
  sharedItemHref,
  sharedItemTypeLabel,
  sharedReadPlan,
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

/** Display name per member id: full name, else email, else `"Member"` (Rust `member_name_map`). */
export function memberNameMap(members: readonly MemberNameSource[]): Map<string, string> {
  const names = rawMemberNameMap([...members]) as MemberName[];
  return new Map(names.map((m) => [m.id, m.name]));
}

/** Count and up to three sample texts of a paper's Zotero annotations, notes excluded (Rust `shared_paper_annotation_summary`). */
export function sharedPaperAnnotationSummary(metadata: Record<string, unknown> | undefined): SharedPaperAnnotationSummary {
  return rawSharedPaperAnnotationSummary(metadata ?? null) as SharedPaperAnnotationSummary;
}
