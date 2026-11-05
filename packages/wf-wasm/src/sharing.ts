/**
 * Sharing and comment domain helpers (Rust `sharing`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/sharing/domain/share.ts and comment.ts.
 */
import {
  isBlanketShare as rawIsBlanketShare,
  normalizeCommentInput as rawNormalizeCommentInput,
  normalizeShareInput as rawNormalizeShareInput,
  shareAllowsComment as rawShareAllowsComment,
  shareAllowsEdit as rawShareAllowsEdit,
  shareCoversResource as rawShareCoversResource,
  shareSupportsEditAccess as rawShareSupportsEditAccess,
} from "../pkg/wf_wasm.js";
import type {
  NewCommentInput,
  NewShareInput,
  ShareGrant as Share,
  ShareableType,
} from "./bindings.js";

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

/** A thrown validation message becomes an `Error`, as the TS validators threw. */
function asError(thrown: unknown): unknown {
  return typeof thrown === "string" ? new Error(thrown) : thrown;
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
  try {
    return rawNormalizeShareInput(input) as Required<NewShareInput>;
  } catch (error) {
    throw asError(error);
  }
}

/** Normalize + validate a comment request. Throws an `Error` with the validation message. */
export function normalizeCommentInput(input: NewCommentInput): NewCommentInput {
  try {
    return rawNormalizeCommentInput(input) as NewCommentInput;
  } catch (error) {
    throw asError(error);
  }
}
