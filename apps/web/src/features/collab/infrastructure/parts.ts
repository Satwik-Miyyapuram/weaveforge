import { oneRow, run } from "@/backend/providers/postgrest/parts-1";
import { readyCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompactOutcome, CrdtUpdateRecord, ICrdtUpdateStore } from "@weaveforge/core";

// --- crdt-snapshot-store ---
/**
 * Reads the `snapshot_upto` watermark on CRDT-backed entity tables (migration 0042).
 *
 * Read only: compaction moves the watermark inside `compact_crdt_log`, in the
 * same transaction that deletes the rows it covers.
 */
const TABLE_BY_TYPE: Record<string, string> = {
  vault_page: "vault_pages",
  report_section: "report_sections",
  log_entry: "log_entries",
};

export class CrdtSnapshotStore {
  constructor(private readonly db: SupabaseClient) {}

  async getSnapshotUpto(resourceType: string, resourceId: string): Promise<number> {
    const table = TABLE_BY_TYPE[resourceType];
    if (!table) return 0;
    const { data, error } = await this.db
      .from(table)
      .select("snapshot_upto")
      .eq("id", resourceId)
      .maybeSingle();
    if (error) throw error;
    return Number((data as { snapshot_upto: number | null } | null)?.snapshot_upto ?? 0);
  }
}

// --- postgrest-crdt-update-store ---
/**
 * The columns a CrdtRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const CRDT_COLUMNS = "id,resource_type,resource_id,project_id,epoch,payload,author_id,created_at";

const TABLE = "crdt_updates";

interface CrdtRow {
  id: number;
  resource_type: string;
  resource_id: string;
  project_id: string | null;
  epoch: number;
  payload: string;
  author_id: string | null;
  created_at: string;
}

function mapRow(row: CrdtRow): CrdtUpdateRecord {
  return {
    id: row.id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    projectId: row.project_id,
    epoch: row.epoch,
    payload: readyCore().decodeBytea(row.payload),
    authorId: row.author_id,
    createdAt: row.created_at,
  };
}

export class PostgrestCrdtUpdateStore implements ICrdtUpdateStore {
  constructor(private readonly db: SupabaseClient) {}

  async append(input: {
    resourceType: string;
    resourceId: string;
    projectId: string | null;
    epoch: number;
    payload: Uint8Array;
    authorId: string;
  }): Promise<CrdtUpdateRecord> {
    const dbRow = await oneRow<CrdtRow>(this.db
      .from(TABLE)
      .insert({
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        project_id: input.projectId,
        epoch: input.epoch,
        payload: readyCore().encodeBytea(input.payload),
        author_id: input.authorId,
      })
      .select(CRDT_COLUMNS)
      .single());
    return mapRow(dbRow);
  }

  async listAfter(
    resourceType: string,
    resourceId: string,
    afterId = 0,
  ): Promise<CrdtUpdateRecord[]> {
    const { data, error } = await this.db
      .from(TABLE)
      .select(CRDT_COLUMNS)
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .gt("id", afterId)
      .order("id", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as CrdtRow[]).map(mapRow);
  }

  async deleteUpTo(resourceType: string, resourceId: string, uptoId: number): Promise<void> {
    await run(this.db
      .from(TABLE)
      .delete()
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .lte("id", uptoId));
  }

  async countAfter(
    resourceType: string,
    resourceId: string,
    afterId = 0,
  ): Promise<number> {
    const { count, error } = await this.db
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .gt("id", afterId);
    if (error) throw error;
    return count ?? 0;
  }

  /**
   * The transactional compaction, through the one function that can do it.
   *
   * The two refusals arrive as PostgreSQL errors, and each means something the
   * caller acts on differently, so they are mapped rather than thrown:
   *
   *   * `42501` (insufficient privilege) — the caller may not edit this
   *     resource. Compaction is not for them, now or later in this session;
   *   * `P0002` (no_data_found) — the row is gone, so there is nothing to
   *     compact. A client that treats this as an error would log a failure every
   *     time it closed a deleted document.
   *
   * Anything else is a real failure and propagates: a `PGRST202` (function not
   * found) means migration `0132` has not been applied, and swallowing it would
   * turn "your database is behind" into "compaction silently stopped".
   */
  async compact(input: {
    resourceType: string;
    resourceId: string;
    uptoId: number;
    currentUpto?: number;
  }): Promise<CompactOutcome> {
    if (input.currentUpto != null && input.uptoId <= input.currentUpto) {
      return { status: "no-op", reason: "stale" };
    }

    const { data, error } = await this.db.rpc("compact_crdt_log", {
      p_resource_type: input.resourceType,
      p_resource_id: input.resourceId,
      p_upto_id: input.uptoId,
    });

    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "42501") return { status: "not-permitted" };
      if (code === "P0002") return { status: "no-op", reason: "missing" };
      throw error;
    }

    return { status: "compacted", deleted: typeof data === "number" ? data : 0 };
  }
}
