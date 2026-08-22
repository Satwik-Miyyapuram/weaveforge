import type { SupabaseClient } from "@supabase/supabase-js";
import type { Comment, ICommentRepository, NewCommentInput } from "@weaveforge/core";
import { commentToDomain, type CommentRow } from "./comment-rows";
import { rows, run } from "@/backend/providers/supabase/row-access";

/**
 * Supabase adapter for comments (migration 0018). `author_id` defaults to
 * auth.uid() server-side; RLS gates who may read (can_view_resource) and add
 * (can_comment_resource).
 */
const TABLE = "comments";

export class SupabaseCommentRepository implements ICommentRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(resourceType: string, resourceId: string): Promise<Comment[]> {
    return (await rows<CommentRow>(this.db
      .from(TABLE)
      .select("*")
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .order("created_at", { ascending: true }))).map(commentToDomain);
  }

  async listAll(): Promise<Comment[]> {
    return (await rows<CommentRow>(this.db
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: true }))).map(commentToDomain);
  }

  async add(input: NewCommentInput): Promise<Comment> {
    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        body: input.body,
      })
      .select("*")
      .single();
    if (error) throw error;
    return commentToDomain(data as CommentRow);
  }

  async save(comment: Comment): Promise<Comment> {
    const row = toRow(comment);
    const { data, error } = await this.db.from(TABLE).upsert(row, { onConflict: "id" }).select("*").single();
    if (error) throw error;
    return commentToDomain(data as CommentRow);
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
