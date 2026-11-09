/** Types for share. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/repository.js";
import { ValidationError } from "../../../shared/errors.js";

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

export class ShareValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "ShareValidationError";
  }
}

/** Share types that support collaborative editing (CRDT path). */
export const CRDT_EDITABLE_SHARE_TYPES: readonly ShareableType[] = [
  "vault_page",
  "report_section",
];

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
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
