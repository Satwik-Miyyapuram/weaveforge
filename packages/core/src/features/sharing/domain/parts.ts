import type {
  Comment,
  NewCommentInput,
  NewShareInput,
  Share,
  ShareableType,
} from "../../../shared/core-contract.js";

// --- comment-repository ---
/** Repository contract for comments (DIP). */
export interface ICommentRepository {
  /** Comments on a resource, oldest first. */
  list(resourceType: string, resourceId: string): Promise<Comment[]>;
  add(input: NewCommentInput): Promise<Comment>;
  remove(id: string): Promise<void>;
  /** Resolve (or reopen) a thread root; returns the new `resolvedAt`. */
  setResolved(id: string, resolved: boolean): Promise<string | null>;
}

// --- share-repository ---
/** Repository contract for shares (DIP). Grant is idempotent per
 * (owner, recipient, type, resource) — re-granting updates the access level. */
export interface IShareRepository {
  /** Create or update a grant; returns the resulting share. */
  grant(input: NewShareInput): Promise<Share>;
  revoke(id: string): Promise<void>;
  /** Grants the signed-in user has made for one resource (null id = the blanket grant). */
  listForResource(resourceType: ShareableType, resourceId: string | null): Promise<Share[]>;
  /** Everything shared *with* the signed-in user, optionally filtered by type. */
  listSharedWithMe(resourceType?: ShareableType): Promise<Share[]>;
}
