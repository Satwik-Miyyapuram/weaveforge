import type {
  Comment,
} from "@weaveforge/core";

/**
 * How comment rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers, which talk to the same table through
 * different clients.
 */

export interface CommentRow {
  id: string;
  author_id: string;
  resource_type: string;
  resource_id: string;
  body: string;
  created_at: string;
  anchor_quote?: string | null;
  anchor_prefix?: string | null;
  anchor_suffix?: string | null;
  parent_id?: string | null;
  resolved_at?: string | null;
}

export function commentToDomain(r: CommentRow): Comment {
  return {
    id: r.id,
    authorId: r.author_id,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    body: r.body,
    createdAt: r.created_at,
    anchor: r.anchor_quote
      ? { quote: r.anchor_quote, prefix: r.anchor_prefix ?? "", suffix: r.anchor_suffix ?? "" }
      : null,
    parentId: r.parent_id ?? null,
    resolvedAt: r.resolved_at ?? null,
  };
}
