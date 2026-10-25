/**
 * A stand-in for the supabase-js client that records writes instead of
 * sending them. Covers only the chain the seeder uses: `from`, `insert`,
 * `select`, `single`, `update`, `delete`, `eq`. Inserts echo their rows back
 * with an id, so code that reads ids from the result keeps working.
 *
 * Used by the seeder's tests and by `seed:showcase --dry-run`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export interface RecordedWrite {
  table: string;
  op: "insert" | "update" | "delete";
  rows?: Row[];
  values?: Row;
  filters?: [string, unknown][];
}

export interface RecordingDb {
  db: SupabaseClient<any, any, any>;
  writes: RecordedWrite[];
  /** Every row inserted into a table, in order. */
  rows(table: string): Row[];
}

type Result = { data: unknown; error: null };

/** A finished query that can be awaited, as supabase-js builders can. */
function settled(data: unknown) {
  const result: Result = { data, error: null };
  return { then: <T>(ok: (r: Result) => T, fail?: (e: unknown) => T) => Promise.resolve(result).then(ok, fail) };
}

export function createRecordingDb(): RecordingDb {
  const writes: RecordedWrite[] = [];

  function filtered(write: RecordedWrite) {
    write.filters = [];
    const chain = {
      ...settled(null),
      eq(col: string, val: unknown) {
        write.filters!.push([col, val]);
        return chain;
      },
    };
    return chain;
  }

  function from(table: string) {
    return {
      insert(input: Row | Row[]) {
        const rows = (Array.isArray(input) ? input : [input]).map((r) => ({ id: crypto.randomUUID(), ...r }));
        writes.push({ table, op: "insert", rows });
        return {
          ...settled(null),
          select: () => ({ ...settled(rows), single: () => settled(rows[0] ?? null) }),
        };
      },
      update(values: Row) {
        const write: RecordedWrite = { table, op: "update", values };
        writes.push(write);
        return filtered(write);
      },
      delete() {
        const write: RecordedWrite = { table, op: "delete" };
        writes.push(write);
        return filtered(write);
      },
    };
  }

  return {
    db: { from } as unknown as SupabaseClient<any, any, any>,
    writes,
    rows: (table) => writes.filter((w) => w.table === table && w.op === "insert").flatMap((w) => w.rows!),
  };
}
