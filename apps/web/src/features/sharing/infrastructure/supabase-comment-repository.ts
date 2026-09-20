import type { SupabaseClient } from "@supabase/supabase-js";
import type { Comment, ICommentRepository, NewCommentInput } from "@weaveforge/core";
import { commentToDomain, type CommentRow } from "./comment-rows";
import { oneRow, rows, run } from "@/backend/providers/supabase/row-access";

/**
 * Supabase adapter for comments (migration 0018). `author_id` defaults to
 * auth.uid() server-side; RLS gates who may read (can_view_resource) and add
 * (can_comment_resource).
 */
/**
 * The columns a CommentRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const COMMENT_COLUMNS = "id,author_id,resource_type,resource_id,body,created_at";

const TABLE = "comments";

export class SupabaseCommentRepository implements ICommentRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(resourceType: string, resourceId: string): Promise<Comment[]> {
    return (await rows<CommentRow>(this.db
      .from(TABLE)
      .select(COMMENT_COLUMNS)
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .order("created_at", { ascending: true }))).map(commentToDomain);
  }

  async listAll(): Promise<Comment[]> {
    return (await rows<CommentRow>(this.db
      .from(TABLE)
      .select(COMMENT_COLUMNS)
      .order("created_at", { ascending: true }))).map(commentToDomain);
  }

  async add(input: NewCommentInput): Promise<Comment> {
    const dbRow = await oneRow<CommentRow>(this.db
      .from(TABLE)
      .insert({
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        body: input.body,
      })
      .select(COMMENT_COLUMNS)
      .single());
    return commentToDomain(dbRow);
  }

  async save(comment: Comment): Promise<Comment> {
    const row = toRow(comment);
    const dbRow = await oneRow<CommentRow>(this.db.from(TABLE).upsert(row, { onConflict: "id" }).select(COMMENT_COLUMNS).single());
    return commentToDomain(dbRow);
  }

  async remove(id: string): Promise<void> {
    await run(this.db.from(TABLE).delete().eq("id", id));
  }
}

function toRow(c: Comment): Record<string, unknown> {
  return {
    id: c.id,
    author_id: c.authorId || undefined,
    resource_type: c.resourceType,
    resource_id: c.resourceId,
    body: c.body ?? "",
    created_at: c.createdAt || undefined,
  };
}
