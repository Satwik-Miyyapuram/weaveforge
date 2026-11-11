import type { SupabaseClient } from "@supabase/supabase-js";
import type { Comment, ICommentRepository, NewCommentInput } from "@weaveforge/core";
// The `comments` row type is generated from Rust; Rust reads a null column as absent.
import type { CommentRowInput as CommentRow } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";
import { oneRow, rows, run, timestampsAsText } from "@/backend/providers/postgrest/parts-1";

/**
 * PostgREST adapter for comments (migration 0018). `author_id` defaults to
 * auth.uid() server-side; RLS gates who may read (can_view_resource) and add
 * (can_comment_resource).
 */
/**
 * The columns a CommentRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const COMMENT_COLUMNS =
  "id,author_id,resource_type,resource_id,body,created_at,anchor_quote,anchor_prefix,anchor_suffix,parent_id,resolved_at";

const TABLE = "comments";

export class PostgrestCommentRepository implements ICommentRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(resourceType: string, resourceId: string): Promise<Comment[]> {
    return (await rows<CommentRow>(this.db
      .from(TABLE)
      .select(COMMENT_COLUMNS)
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .order("created_at", { ascending: true }))).map((r) => readyCore().commentFromRow(timestampsAsText(r)));
  }

  async add(input: NewCommentInput): Promise<Comment> {
    const dbRow = await oneRow<CommentRow>(this.db
      .from(TABLE)
      .insert({
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        body: input.body,
        anchor_quote: input.anchor?.quote ?? null,
        anchor_prefix: input.anchor?.prefix ?? null,
        anchor_suffix: input.anchor?.suffix ?? null,
        parent_id: input.parentId ?? null,
      })
      .select(COMMENT_COLUMNS)
      .single());
    return readyCore().commentFromRow(timestampsAsText(dbRow));
  }

  async remove(id: string): Promise<void> {
    await run(this.db.from(TABLE).delete().eq("id", id));
  }

  /**
   * Through `set_comment_resolved` (0133), not an update: the page owner may
   * resolve someone else's thread, and an UPDATE policy that allowed that would
   * also let them rewrite its body.
   */
  async setResolved(id: string, resolved: boolean): Promise<string | null> {
    const { data, error } = await this.db.rpc("set_comment_resolved", { p_comment_id: id, p_resolved: resolved });
    if (error) throw error;
    return (data as string | null) ?? null;
  }
}
