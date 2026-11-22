import type { SupabaseClient } from "@supabase/supabase-js";
import type { Install097Reads } from "./install-097-web-port";

/** Postgres undefined_column, and PostgREST's unknown-column code. Both mean the 0164 mark is not deployed yet. */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

/** Reads through the signed-in data client. RLS scopes every row to the signed-in user. */
export function supabaseReads(client: SupabaseClient): Install097Reads {
  return {
    async exportedAt(userId) {
      const { data, error } = await client.from("profiles").select("exported_097_at").eq("id", userId).maybeSingle();
      if (error) {
        if (MISSING_COLUMN_CODES.has(error.code)) return null;
        throw new Error(`profiles mark read failed: ${error.code}`);
      }
      return (data?.exported_097_at as string | null | undefined) ?? null;
    },
    async countRows(table) {
      const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).limit(1);
      if (error) throw new Error(`count ${table} failed: ${error.code}`);
      if (typeof count !== "number") throw new Error(`count ${table} returned no total`);
      return count;
    },
  };
}
