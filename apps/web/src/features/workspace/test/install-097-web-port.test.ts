import type { SupabaseClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { install097Check } from "../application/install-097-guard";
import { LEGACY_PERSONAL_TABLES } from "../application/install-097-legacy-tables";
import { createWebOldUserPort, type Install097Reads } from "../infrastructure/install-097-web-port";
import { supabaseReads } from "../infrastructure/install-097-supabase-reads";

/** Fake reads: `mark` answers exportedAt, `rows` answers countRows per table (default 0). */
function fakeReads(mark: () => Promise<string | null>, rows: (table: string) => Promise<number> = async () => 0) {
  const counted: string[] = [];
  let markReads = 0;
  const reads: Install097Reads = {
    exportedAt: async () => {
      markReads += 1;
      return mark();
    },
    countRows: async (table) => {
      counted.push(table);
      return rows(table);
    },
  };
  return { reads, counted, markReads: () => markReads };
}

test("legacy table list is the 21 tables 0165 moves, copied from db/held/0165", () => {
  assert.equal(LEGACY_PERSONAL_TABLES.length, 21);
  assert.ok(LEGACY_PERSONAL_TABLES.includes("papers"));
  assert.ok(LEGACY_PERSONAL_TABLES.includes("reader_annotations"));
});

test("mark present: open, and the row reads are skipped", async () => {
  const { reads, counted } = fakeReads(async () => "2026-11-01T00:00:00Z");
  const port = createWebOldUserPort(reads, "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
  assert.equal(counted.length, 0, "no table is counted once the mark is present");
});

test("mark null and a table has rows: unverified with the web export action", async () => {
  const { reads } = fakeReads(
    async () => null,
    async (table) => (table === "papers" ? 3 : 0),
  );
  const port = createWebOldUserPort(reads, "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "unverified", action: "web-export" });
});

test("mark null and every table empty: open (new account)", async () => {
  const { reads, counted } = fakeReads(async () => null);
  const port = createWebOldUserPort(reads, "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
  assert.equal(counted.length, LEGACY_PERSONAL_TABLES.length);
});

test("mark column missing (read as null) and every table empty: open, never gated", async () => {
  const supabase = fakeSupabase({ profileError: { code: "42703", message: "column does not exist" } });
  const port = createWebOldUserPort(supabaseReads(supabase), "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
});

test("a count error: unknown, fail closed", async () => {
  const { reads } = fakeReads(
    async () => null,
    async () => {
      throw new Error("count failed");
    },
  );
  const port = createWebOldUserPort(reads, "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "unknown", code: "OLD_USER_CHECK_FAILED" });
});

test("a count that is not a number: unknown, fail closed", async () => {
  const { reads } = fakeReads(
    async () => null,
    async () => null as unknown as number,
  );
  const port = createWebOldUserPort(reads, "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "unknown", code: "OLD_USER_CHECK_FAILED" });
});

test("a mark read error that is not a missing column: unknown, fail closed", async () => {
  const supabase = fakeSupabase({ profileError: { code: "08006", message: "connection lost" } });
  const port = createWebOldUserPort(supabaseReads(supabase), "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "unknown", code: "OLD_USER_CHECK_FAILED" });
});

test("the mark is read once per check, not once per question", async () => {
  const { reads, markReads } = fakeReads(async () => null, async () => 1);
  const port = createWebOldUserPort(reads, "user-1");
  await install097Check(null, null, port);
  assert.equal(markReads(), 1);
});

/** A minimal Supabase-shaped fake: profiles read and per-table HEAD counts. */
function fakeSupabase(opts: { profileError?: { code: string; message: string }; countError?: boolean }) {
  return {
    from(table: string) {
      return {
        select(_cols: string, options?: { count?: string; head?: boolean }) {
          if (table === "profiles") {
            return {
              eq: () => ({
                maybeSingle: async () =>
                  opts.profileError ? { data: null, error: opts.profileError } : { data: { exported_097_at: null }, error: null },
              }),
            };
          }
          const head = options?.head === true && options.count === "exact";
          return {
            limit: async () =>
              !head || opts.countError ? { count: null, error: { code: "PGRST", message: "boom" } } : { count: 0, error: null },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}
