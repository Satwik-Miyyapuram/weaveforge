import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PostgrestPaperRelationRepository } from "../postgrest-paper-relation-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";

/**
 * A paper's relations (26-10). The id used to be spliced into a PostgREST
 * `or=(…)` filter, where a comma or bracket in it rewrote the filter. It is
 * now only ever a bound value.
 */

const row = (id: string, from: string, to: string) => ({
  id, from_paper: from, to_paper: to, relation: "cites", note: null, source: "manual", created_at: "2026-01-01",
});

function repo(answer: (sql: string, params: unknown[]) => unknown[]) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const run: LocalQuery = async (statement, bound) => {
    sql.push(statement);
    params.push(bound ?? []);
    return answer(statement, bound ?? []) as never;
  };
  const r = new PostgrestPaperRelationRepository(createLocalClient(run) as unknown as SupabaseClient, { projectId: "p1" });
  return { r, sql, params };
}

test("a hostile paper id stays a bound value and widens nothing", async () => {
  const id = "a,to_paper.neq.zzz)";
  const { r, sql, params } = repo(() => []);
  assert.deepEqual(await r.relationsFor(id), []);
  assert.ok(sql.length > 0);
  for (const s of sql) assert.ok(!s.includes(id), s);
  assert.ok(params.flat().includes(id));
});

test("relations on either side are returned once each, a self-edge once", async () => {
  const { r } = repo((s) =>
    /"from_paper"\s*=/.test(s)
      ? [row("r1", "a", "b"), row("self", "a", "a")]
      : [row("r2", "c", "a"), row("self", "a", "a")],
  );
  const ids = (await r.relationsFor("a")).map((x) => x.id).sort();
  assert.deepEqual(ids, ["r1", "r2", "self"]);
});
