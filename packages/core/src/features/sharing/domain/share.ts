/**
 * Sharing domain — a Share grants another member read (and optionally comment)
 * access to one of your items, or to *all* of a type (a blanket grant, when
 * `resourceId` is null). Access is chosen by the sharer; the default is
 * "comment" so a supervisor can give feedback. Persisted in the `shares` table
 * (migration 0018); writes stay owner-only, so a share never confers edit rights.
 */

import type { Identifiable } from "../../../shared/repository.js";

export type ShareableType =
  | "milestone"
  | "experiment"
  | "report_section"
  | "reading_list"
  | "paper"
  | "vault_page";

export const SHAREABLE_TYPES: readonly ShareableType[] = [
  "milestone",
  "experiment",
  "report_section",
  "reading_list",
  "paper",
  "vault_page",
];

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

export class ShareValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareValidationError";
  }
}

/** Whether a share grant covers every resource of a type (resourceId is null). */
export function isBlanketShare(resourceId: string | null): boolean {
  return resourceId === null;
}

/** Share types that support collaborative editing (CRDT path). */
export const CRDT_EDITABLE_SHARE_TYPES: readonly ShareableType[] = [
  "vault_page",
  "report_section",
];

export function shareSupportsEditAccess(
  resourceType: ShareableType,
  resourceId: string | null,
): boolean {
  return resourceId != null && CRDT_EDITABLE_SHARE_TYPES.includes(resourceType);
}

/** Whether a share grant covers a specific resource (including blanket grants). */
export function shareCoversResource(
  share: Pick<Share, "resourceType" | "resourceId" | "ownerId">,
  resourceType: ShareableType,
  resourceId: string,
  ownerId: string,
): boolean {
  return (
    share.resourceType === resourceType &&
    share.ownerId === ownerId &&
    (share.resourceId === resourceId || share.resourceId === null)
  );
}

/** Whether a share grant allows commenting on a specific resource. */
export function shareAllowsComment(
  share: Pick<Share, "resourceType" | "resourceId" | "ownerId" | "access">,
  resourceType: ShareableType,
  resourceId: string,
  ownerId: string,
): boolean {
  return (
    shareCoversResource(share, resourceType, resourceId, ownerId) &&
    (share.access === "comment" || share.access === "edit")
  );
}

/** Whether a share grant allows collaborative editing (CRDT path). */
export function shareAllowsEdit(
  share: Pick<Share, "resourceType" | "resourceId" | "ownerId" | "access">,
  resourceType: ShareableType,
  resourceId: string,
  ownerId: string,
): boolean {
  return shareCoversResource(share, resourceType, resourceId, ownerId) && share.access === "edit";
}

/** Normalize + validate a grant request (pure). */
export function normalizeShareInput(input: NewShareInput): Required<NewShareInput> {
  if (!input.recipientId) throw new ShareValidationError("A recipient is required.");
  if (!SHAREABLE_TYPES.includes(input.resourceType)) {
    throw new ShareValidationError(`Unknown resource type "${input.resourceType}".`);
  }
  return {
    recipientId: input.recipientId,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    access: input.access ?? "comment",
  };
}
