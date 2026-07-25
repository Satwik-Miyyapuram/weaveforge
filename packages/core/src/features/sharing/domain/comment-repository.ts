/** Repository contract for comments (DIP). */

import type { Comment, NewCommentInput } from "./comment.js";

export interface ICommentRepository {
  /** Comments on a resource, oldest first. */
  list(resourceType: string, resourceId: string): Promise<Comment[]>;
  add(input: NewCommentInput): Promise<Comment>;
  /** Persist a full comment row (encrypted save path). */
  save(comment: Comment): Promise<Comment>;
  /** All comments visible to the current user (E2EE migration). */
  listAll(): Promise<Comment[]>;
  remove(id: string): Promise<void>;
}
