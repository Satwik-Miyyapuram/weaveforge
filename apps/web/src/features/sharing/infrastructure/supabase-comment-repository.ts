import type { SupabaseClient } from "@supabase/supabase-js";
import type { Comment, ICommentRepository, NewCommentInput } from "@weaveforge/core";
import {
  attachEncryptedRow,
  encryptedRowFields,
} from "@/lib/encrypted-row";
import { commentToDomain, type CommentRow as StoredCommentRow } from "./comment-rows";

/**
 * Supabase adapter for comments (migration 0018). `author_id` defaults to
 * auth.uid() server-side; RLS gates who may read (can_view_resource) and add
 * (can_comment_resource).
 */
/** The stored row plus the columns only this provider carries. */
interface CommentRow extends StoredCommentRow {
  content_enc: string | null;
  enc_epoch: number | null;
}
const TABLE = "comments";

export class SupabaseCommentRepository implements ICommentRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(resourceType: string, resourceId: string): Promise<Comment[]> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as CommentRow[]).map(toDomain);
  }

  async listAll(): Promise<Comment[]> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as CommentRow[]).map(toDomain);
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
    return toDomain(data as CommentRow);
  }

  async save(comment: Comment): Promise<Comment> {
    const row = toRow(comment);
    const { data, error } = await this.db.from(TABLE).upsert(row, { onConflict: "id" }).select("*").single();
    if (error) throw error;
    return toDomain(data as CommentRow);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
  }
}

function toDomain(r: CommentRow): Comment  {
  return attachEncryptedRow(commentToDomain(r), r);
}

function toRow(c: Comment): Record<string, unknown> {
  return {
    id: c.id,
    author_id: c.authorId || undefined,
    resource_type: c.resourceType,
    resource_id: c.resourceId,
    body: c.body ?? "",
    created_at: c.createdAt || undefined,
    ...encryptedRowFields(c),
  };
}
