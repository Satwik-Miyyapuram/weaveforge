import type {
  Comment,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

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
  return readyCore().commentFromRow(r);
}
