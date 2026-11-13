import { rustRepository } from "@/backend/providers/postgrest/rust-repository";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrdtUpdateRecord, ICrdtUpdateStore } from "@weaveforge/core";

// --- crdt-snapshot-store ---
/**
 * Reads the `snapshot_upto` watermark on CRDT-backed entity tables (migration 0042).
 *
 * Read only: compaction moves the watermark inside `compact_crdt_log`, in the
 * same transaction that deletes the rows it covers. Rust plans the query
 * (`crates/wf-core/src/repos/crdt_updates.rs`); an unknown type reads 0.
 */
export interface CrdtSnapshotStore {
  getSnapshotUpto(resourceType: string, resourceId: string): Promise<number>;
}

/** The watermark reader through the Rust step engine. */
export function rustCrdtSnapshotStore(db: SupabaseClient): CrdtSnapshotStore {
  return rustRepository<CrdtSnapshotStore>(db, "crdt_snapshots", ["getSnapshotUpto"]);
}

// --- crdt-update-store ---
/** A record as Rust returns it: the bytea payload as a number array. */
type WireRecord = Omit<CrdtUpdateRecord, "payload"> & { payload: number[] };

function withBytes(record: WireRecord): CrdtUpdateRecord {
  return { ...record, payload: Uint8Array.from(record.payload) };
}

/**
 * The `crdt_updates` log through the Rust step engine. Compaction's two refusals
 * (`42501`, `P0002`) come back as outcomes; any other error throws.
 */
export function rustCrdtUpdateStore(db: SupabaseClient): ICrdtUpdateStore {
  type Wire = Omit<ICrdtUpdateStore, "append" | "listAfter"> & {
    append(input: Parameters<ICrdtUpdateStore["append"]>[0]): Promise<WireRecord>;
    listAfter(resourceType: string, resourceId: string, afterId?: number): Promise<WireRecord[]>;
  };
  const repo = rustRepository<Wire>(db, "crdt_updates", ["append", "listAfter", "deleteUpTo", "countAfter", "compact"]);
  return {
    ...repo,
    append: async (input) => withBytes(await repo.append(input)),
    listAfter: async (type, id, afterId) => (await repo.listAfter(type, id, afterId)).map(withBytes),
  };
}
