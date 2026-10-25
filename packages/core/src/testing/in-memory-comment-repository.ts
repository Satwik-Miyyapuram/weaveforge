import type { ICommentRepository } from "../features/sharing/domain/comment-repository.js";
import type { Comment, NewCommentInput } from "../features/sharing/domain/comment.js";
import { ValidationError } from "../shared/errors.js";

/** In-memory {@link ICommentRepository}. `currentId` = the comment author. */
export class InMemoryCommentRepository implements ICommentRepository {
  private readonly store = new Map<string, Comment>();
  private seq = 0;
  constructor(private currentId: string = "me") {}

  setCurrent(id: string): void {
    this.currentId = id;
  }

  async list(resourceType: string, resourceId: string): Promise<Comment[]> {
    return [...this.store.values()]
      .filter((c) => c.resourceType === resourceType && c.resourceId === resourceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({ ...c }));
  }

  async add(input: NewCommentInput): Promise<Comment> {
    // As the `comments_check_new` trigger: a reply answers a root comment on
    // the same resource, and sits on that root's anchor.
    if (input.parentId) {
      const parent = this.store.get(input.parentId);
      if (
        !parent ||
        parent.parentId !== null ||
        parent.resourceType !== input.resourceType ||
        parent.resourceId !== input.resourceId
      ) {
        throw new ValidationError("a reply answers a comment on the same resource");
      }
    }
    const comment: Comment = {
      id: `comment-${++this.seq}`,
      authorId: this.currentId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      body: input.body,
      anchor: input.parentId ? null : (input.anchor ?? null),
      parentId: input.parentId ?? null,
      resolvedAt: null,
      createdAt: new Date(this.seq).toISOString(),
    };
    this.store.set(comment.id, comment);
    return { ...comment };
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
    // Replies go with their root, as `on delete cascade` does.
    for (const [key, c] of this.store) if (c.parentId === id) this.store.delete(key);
  }

  async setResolved(id: string, resolved: boolean): Promise<string | null> {
    const c = this.store.get(id);
    if (!c) throw new Error("comment not found");
    if (c.parentId) throw new Error("resolve the thread, not a reply");
    c.resolvedAt = resolved ? new Date(++this.seq).toISOString() : null;
    return c.resolvedAt;
  }
}
