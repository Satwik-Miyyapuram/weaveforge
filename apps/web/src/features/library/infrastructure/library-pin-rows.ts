import type {
  LibraryPin,
  ShareableType,
} from "@weaveforge/core";

/**
 * How library pin rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface PinRow {
  id: string;
  user_id: string;
  project_id: string;
  resource_type: ShareableType;
  resource_id: string;
  owner_id: string;
  created_at: string;
}

export function toDomain(row: PinRow): LibraryPin {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}
