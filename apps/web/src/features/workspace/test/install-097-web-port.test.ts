import type { SupabaseClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { install097Check } from "../application/install-097-guard";
import { LEGACY_PERSONAL_TABLES, type LegacyTable } from "../application/install-097-legacy-tables";
import { createWebOldUserPort, TABLE_ARCHIVED } from "../infrastructure/install-097-web-port";
import { supabaseReads } from "../infrastructure/install-097-supabase-reads";
import { signedInWebPort, type SignedInSource } from "../infrastructure/install-097-signed-in-port";

type Err = { code: string; message: string };
type Row = Record<string, string>;

interface FakeOpts {
  /** profiles.exported_097_at read result. Default: no mark, no error. */
  profile?: { data: unknown; error: Err | null };
  /** Rows per table. Keys are the owner column (or "papers.user_id" for an embedded parent). */
  rows?: Record<string, Row[]>;
  /** Tables 0165 has archived: PostgREST answers PGRST205. */
  archived?: string[];
  /** Tables whose count fails with this error. */
  failTables?: string[];
  failWith?: Err;
  /** Counts come back null with no error (not a number). */
  countNull?: boolean;
  rpc?: { data: unknown; error: Err | null };
  session?: { data: { session: { user: { id: string } } | null }; error: Err | null };
}

/** A Supabase-shaped fake: profiles read, owner-filtered HEAD counts, and the rpc. */
function fakeSupabase(opts: FakeOpts = {}): SupabaseClient {
  const from = (table: string) => ({
    select(_cols: string, _options?: { count?: string; head?: boolean }) {
      if (table === "profiles") {
        // profiles is keyed by user_id; any other column is unknown to PostgREST.
        return {
          eq: (column: string) => ({
            maybeSingle: async () =>
              column === "user_id"
                ? (opts.profile ?? { data: null, error: null })
                : { data: null, error: { code: "42703", message: `column profiles.${column} does not exist` } },
          }),
        };
      }
      let filter: [string, string] | undefined;
      const run = () => {
        if (opts.archived?.includes(table)) return { count: null, data: null, error: { code: "PGRST205", message: "not found" } };
        // An embedded parent that 0165 archived: PostgREST has no relationship to embed (PGRST200).
        const parent = filter?.[0].includes(".") ? filter[0].split(".")[0] : undefined;
        if (parent && opts.archived?.includes(parent)) return { count: null, data: null, error: { code: "PGRST200", message: "no relationship" } };
        if (opts.failTables?.includes(table)) return { count: null, data: null, error: opts.failWith ?? { code: "42501", message: "denied" } };
        if (opts.countNull) return { count: null, data: null, error: null };
        const [column, value] = filter ?? ["", ""];
        const matched = (opts.rows?.[table] ?? []).filter((row) => row[column] === value);
        return { count: matched.length, data: null, error: null };
      };
      const query = {
        eq(column: string, value: string) {
          filter = [column, value];
          return query;
        },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return query;
    },
  });
  return {
    from,
    rpc: async () => opts.rpc ?? { data: null, error: { code: "PGRST202", message: "function not found" } },
    auth: {
      getSession: async () => opts.session ?? { data: { session: null }, error: null },
    },
  } as unknown as SupabaseClient;
}

function legacy(name: string): LegacyTable {
  const found = LEGACY_PERSONAL_TABLES.find((t) => t.table === name);
  if (!found) throw new Error(`${name} is not a legacy table`);
  return found;
}

const ALL_LEGACY = LEGACY_PERSONAL_TABLES.map((t) => t.table);

const markSet = { data: { exported_097_at: "2026-11-01T00:00:00Z" }, error: null };

// ---- the table list ----

test("legacy table list is the 21 tables 0165 moves, each with its owner filter", () => {
  assert.equal(LEGACY_PERSONAL_TABLES.length, 21);
  assert.equal(legacy("screening_decisions").filter, "reviewer_id");
  assert.equal(legacy("papers").filter, "user_id");
  assert.equal(legacy("paper_tags").filter, "papers.user_id");
  assert.match(legacy("paper_tags").select, /papers!inner\(user_id\)/);
  assert.equal(legacy("reading_list_items").filter, "reading_lists.user_id");
  assert.equal(legacy("project_integrations").filter, "projects.user_id");
});

// ---- the port, end to end through supabaseReads ----

test("mark present: open, and no table is counted", async () => {
  const port = createWebOldUserPort(supabaseReads(fakeSupabase({ profile: markSet, rows: { papers: [{ user_id: "user-1" }] } })), "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
});

test("mark null and this user has a paper: unverified with the web export action", async () => {
  const port = createWebOldUserPort(supabaseReads(fakeSupabase({ rows: { papers: [{ user_id: "user-1" }] } })), "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "unverified", action: "web-export" });
});

test("mark null and every table empty (new account): open", async () => {
  const port = createWebOldUserPort(supabaseReads(fakeSupabase()), "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
});

test("P2: rows owned by other users do not gate a new account", async () => {
  const rows = {
    papers: [{ user_id: "other" }],
    paper_tags: [{ "papers.user_id": "other" }],
    reading_lists: [{ user_id: "other" }],
    reading_list_items: [{ "reading_lists.user_id": "other" }],
    project_integrations: [{ "projects.user_id": "other" }],
    screening_decisions: [{ reviewer_id: "co-reviewer" }],
  };
  const port = createWebOldUserPort(supabaseReads(fakeSupabase({ rows })), "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
});

test("P2: a row this user owns through a parent join does gate", async () => {
  const rows = { paper_tags: [{ "papers.user_id": "user-1" }] };
  const port = createWebOldUserPort(supabaseReads(fakeSupabase({ rows })), "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "unverified", action: "web-export" });
});

test("P1: archived tables and the rpc says no rows: open", async () => {
  const port = createWebOldUserPort(
    supabaseReads(fakeSupabase({ archived: ALL_LEGACY, rpc: { data: false, error: null } })),
    "user-1",
  );
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
});

test("P1: archived tables and the rpc says rows are pending: unverified with the web export action", async () => {
  const port = createWebOldUserPort(
    supabaseReads(fakeSupabase({ archived: ALL_LEGACY, rpc: { data: true, error: null } })),
    "user-1",
  );
  assert.deepEqual(await install097Check(null, null, port), { kind: "unverified", action: "web-export" });
});

test("P1: archived tables and the rpc is missing: unknown, fail closed", async () => {
  const port = createWebOldUserPort(supabaseReads(fakeSupabase({ archived: ALL_LEGACY })), "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "unknown", code: "OLD_USER_CHECK_FAILED" });
});

test("P1: a new account with archived tables and rpc false: open, never gated", async () => {
  const port = createWebOldUserPort(
    supabaseReads(fakeSupabase({ profile: { data: null, error: null }, archived: ALL_LEGACY, rpc: { data: false, error: null } })),
    "new-user",
  );
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
});

test("mark column missing (42703) and every table empty: open, never gated", async () => {
  const port = createWebOldUserPort(
    supabaseReads(fakeSupabase({ profile: { data: null, error: { code: "42703", message: "column profiles.exported_097_at does not exist" } } })),
    "user-1",
  );
  assert.deepEqual(await install097Check(null, null, port), { kind: "open" });
});

test("a count error: unknown, fail closed", async () => {
  const port = createWebOldUserPort(
    supabaseReads(fakeSupabase({ failTables: ["papers"], failWith: { code: "42501", message: "denied" } })),
    "user-1",
  );
  assert.deepEqual(await install097Check(null, null, port), { kind: "unknown", code: "OLD_USER_CHECK_FAILED" });
});

test("a count that is not a number: unknown, fail closed", async () => {
  const port = createWebOldUserPort(supabaseReads(fakeSupabase({ countNull: true })), "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "unknown", code: "OLD_USER_CHECK_FAILED" });
});

test("a mark read error that is not a missing column: unknown, fail closed", async () => {
  const port = createWebOldUserPort(
    supabaseReads(fakeSupabase({ profile: { data: null, error: { code: "08006", message: "connection lost" } } })),
    "user-1",
  );
  assert.deepEqual(await install097Check(null, null, port), { kind: "unknown", code: "OLD_USER_CHECK_FAILED" });
});

test("a positive table gates even when another probe fails", async () => {
  const port = createWebOldUserPort(
    supabaseReads(fakeSupabase({ rows: { papers: [{ user_id: "user-1" }] }, failTables: ["tags"] })),
    "user-1",
  );
  assert.deepEqual(await install097Check(null, null, port), { kind: "unverified", action: "web-export" });
});

// ---- supabaseReads mapping ----

test("exportedAt: value returned; a missing exported_097_at column reads as null; other errors throw", async () => {
  const value = await supabaseReads(fakeSupabase({ profile: { data: { exported_097_at: "2026" }, error: null } })).exportedAt("u");
  assert.equal(value, "2026");
  // The mark is not deployed yet: the error names the column (Postgres 42703 or PostgREST PGRST204).
  const missingMark = [
    { code: "42703", message: "column profiles.exported_097_at does not exist" },
    { code: "PGRST204", message: "Could not find the 'exported_097_at' column of 'profiles' in the schema cache" },
  ];
  for (const error of missingMark) {
    assert.equal(await supabaseReads(fakeSupabase({ profile: { data: null, error } })).exportedAt("u"), null);
  }
  await assert.rejects(supabaseReads(fakeSupabase({ profile: { data: null, error: { code: "08006", message: "" } } })).exportedAt("u"));
});

test("exportedAt: a missing column that is not exported_097_at throws, so a wrong filter column is not hidden", async () => {
  const wrongColumn = { code: "42703", message: "column profiles.user_uuid does not exist" };
  await assert.rejects(supabaseReads(fakeSupabase({ profile: { data: null, error: wrongColumn } })).exportedAt("u"), /profiles mark read failed: 42703/);
});

test("countRows: counts only the owner's rows", async () => {
  const reads = supabaseReads(fakeSupabase({ rows: { papers: [{ user_id: "user-1" }, { user_id: "other" }, { user_id: "user-1" }] } }));
  assert.equal(await reads.countRows(legacy("papers"), "user-1"), 2);
});

test("countRows: PGRST205 and 42P01 are TABLE_ARCHIVED, other codes throw", async () => {
  const archived = supabaseReads(fakeSupabase({ archived: ["papers"] }));
  assert.equal(await archived.countRows(legacy("papers"), "user-1"), TABLE_ARCHIVED);
  const pg = supabaseReads(fakeSupabase({ failTables: ["papers"], failWith: { code: "42P01", message: "" } }));
  assert.equal(await pg.countRows(legacy("papers"), "user-1"), TABLE_ARCHIVED);
  const denied = supabaseReads(fakeSupabase({ failTables: ["papers"], failWith: { code: "42501", message: "" } }));
  await assert.rejects(denied.countRows(legacy("papers"), "user-1"));
});

test("a child whose parent 0165 archived (PGRST200) throws, so the check fails closed", async () => {
  const reads = supabaseReads(fakeSupabase({ archived: ["papers"] }));
  await assert.rejects(reads.countRows(legacy("paper_tags"), "user-1"), /PGRST200/);
  const port = createWebOldUserPort(supabaseReads(fakeSupabase({ archived: ["papers"] })), "user-1");
  assert.deepEqual(await install097Check(null, null, port), { kind: "unknown", code: "OLD_USER_CHECK_FAILED" });
});

test("legacyRowsPending: the rpc boolean; an error or a non-boolean throws", async () => {
  assert.equal(await supabaseReads(fakeSupabase({ rpc: { data: true, error: null } })).legacyRowsPending(), true);
  await assert.rejects(supabaseReads(fakeSupabase({ rpc: { data: null, error: { code: "PGRST202", message: "" } } })).legacyRowsPending());
  await assert.rejects(supabaseReads(fakeSupabase({ rpc: { data: "yes", error: null } })).legacyRowsPending());
});

// ---- signedInWebPort ----

function source(opts: { local: boolean; client?: SupabaseClient }): SignedInSource {
  return {
    isLocalMode: () => opts.local,
    client: () => {
      if (!opts.client) throw new Error("the client must not be used");
      return opts.client;
    },
  };
}

test("signedInWebPort: local mode returns null and never touches the client", async () => {
  assert.equal(await signedInWebPort(async () => source({ local: true })), null);
});

test("signedInWebPort: a getSession error rejects", async () => {
  const client = fakeSupabase({ session: { data: { session: null }, error: { code: "AuthError", message: "boom" } } });
  await assert.rejects(signedInWebPort(async () => source({ local: false, client })));
});

test("signedInWebPort: nobody signed in returns null", async () => {
  const client = fakeSupabase({ session: { data: { session: null }, error: null } });
  assert.equal(await signedInWebPort(async () => source({ local: false, client })), null);
});

test("signedInWebPort: signed in returns a port that checks this user's rows", async () => {
  const client = fakeSupabase({
    session: { data: { session: { user: { id: "user-1" } } }, error: null },
    rows: { papers: [{ user_id: "other" }, { user_id: "user-1" }] },
  });
  const port = await signedInWebPort(async () => source({ local: false, client }));
  assert.ok(port);
  assert.equal(await port.hasLegacyRows(), true);
});
