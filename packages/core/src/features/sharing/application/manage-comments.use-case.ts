/** Use-case for comments. Validates then delegates (RLS gates who may add). */
import {
  normalizeCommentInput,
  type Comment,
  type NewCommentInput,
} from "../domain/comment.js";
import type { ICommentRepository } from "../domain/comment-repository.js";

export interface ManageCommentsDeps {
  repository: ICommentRepository;
}

export class ManageCommentsUseCase {
  constructor(private readonly deps: ManageCommentsDeps) {}

  list(resourceType: string, resourceId: string): Promise<Comment[]> {
    return this.deps.repository.list(resourceType, resourceId);
  }

  async add(input: NewCommentInput): Promise<Comment> {
    return this.deps.repository.add(normalizeCommentInput(input));
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.remove(id);
  }
}
