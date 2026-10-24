/** Repository contract for comments (DIP). */

import type { Comment, NewCommentInput } from "./comment.js";

export interface ICommentRepository {
  /** Comments on a resource, oldest first. */
  list(resourceType: string, resourceId: string): Promise<Comment[]>;
  add(input: NewCommentInput): Promise<Comment>;
  remove(id: string): Promise<void>;
  /** Resolve (or reopen) a thread root; returns the new `resolvedAt`. */
  setResolved(id: string, resolved: boolean): Promise<string | null>;
}
