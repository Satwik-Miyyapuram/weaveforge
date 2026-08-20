import type {
  Share,
  ShareableType,
} from "@weaveforge/core";

/**
 * How share rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface ShareRow {
  id: string;
  owner_id: string;
  recipient_id: string;
  resource_type: ShareableType;
  resource_id: string | null;
  access: "view" | "comment";
  created_at: string;
}

export function toDomain(r: ShareRow): Share {
  return {
    id: r.id,
    ownerId: r.owner_id,
    recipientId: r.recipient_id,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    access: r.access,
    createdAt: r.created_at,
  };
}
