import type { ICommentRepository } from "../features/sharing/domain/comment-repository.js";
import type { Comment, NewCommentInput } from "../features/sharing/domain/comment.js";

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
    const comment: Comment = {
      id: `comment-${++this.seq}`,
      authorId: this.currentId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      body: input.body,
      anchor: input.anchor ?? null,
      parentId: input.parentId ?? null,
      resolvedAt: null,
      createdAt: new Date(this.seq).toISOString(),
    };
    this.store.set(comment.id, comment);
    return { ...comment };
  }

  async save(comment: Comment): Promise<Comment> {
    this.store.set(comment.id, { ...comment });
    return { ...comment };
  }

  async listAll(): Promise<Comment[]> {
    return [...this.store.values()].map((c) => ({ ...c }));
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
