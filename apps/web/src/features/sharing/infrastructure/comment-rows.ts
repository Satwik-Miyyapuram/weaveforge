import type {
  Comment,
} from "@weaveforge/core";

/**
 * How comment rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers, which talk to the same table through
 * different clients. The Supabase repository layers the encrypted-row columns
 * on top of this; Postgres does not have them.
 */

export interface CommentRow {
  id: string;
  author_id: string;
  resource_type: string;
  resource_id: string;
  body: string;
  created_at: string;
}

export function commentToDomain(r: CommentRow): Comment {
  return {
    id: r.id,
    authorId: r.author_id,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    body: r.body,
    createdAt: r.created_at,
  };
}
