import type { SupabaseClient } from "@supabase/supabase-js";
import type { LegacyTable } from "../application/install-097-legacy-tables";
import { type Install097Reads, TABLE_ARCHIVED, type TableCount } from "./install-097-web-port";

/** Postgres undefined_column, and PostgREST's unknown-column code. Only a miss on the 0164 mark column counts as "not deployed yet". */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);
const MARK_COLUMN = "exported_097_at";
/** PostgREST's unknown-table code and Postgres undefined_table. 0165 archives a table, so it is gone from public. */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

/**
 * Reads through the signed-in data client. Row counts are filtered to the signed-in user's own rows
 * by the owner column (RLS alone would also count rows the user shares or reviews).
 */
export function supabaseReads(client: SupabaseClient): Install097Reads {
  return {
    async exportedAt(userId) {
      const { data, error } = await client.from("profiles").select("exported_097_at").eq("user_id", userId).maybeSingle();
      if (error) {
        if (MISSING_COLUMN_CODES.has(error.code) && error.message?.includes(MARK_COLUMN)) return null;
        throw new Error(`profiles mark read failed: ${error.code}`);
      }
      return (data?.exported_097_at as string | null | undefined) ?? null;
    },
    async countRows(table: LegacyTable, userId: string): Promise<TableCount> {
      const { count, error } = await client
        .from(table.table)
        .select(table.select, { count: "exact", head: true })
        .eq(table.filter, userId);
      if (error) {
        if (MISSING_TABLE_CODES.has(error.code)) return TABLE_ARCHIVED;
        throw new Error(`count ${table.table} failed: ${error.code}`);
      }
      if (typeof count !== "number") throw new Error(`count ${table.table} returned no total`);
      return count;
    },
    async legacyRowsPending() {
      const { data, error } = await client.rpc("legacy_rows_pending_097");
      if (error) throw new Error(`legacy_rows_pending_097 failed: ${error.code}`);
      if (typeof data !== "boolean") throw new Error("legacy_rows_pending_097 returned no boolean");
      return data;
    },
  };
}
