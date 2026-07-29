import assert from "node:assert/strict";
import test from "node:test";
import { PostgresReaderAnnotationRepository } from "../repositories/reader-annotation-repository";
import type { PgRunner } from "../pg-runner";

const UID = "user-1";
const PROJECT = "project-1";

interface Call {
  sql: string;
  params: unknown[];
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "ann-1",
    paper_id: "paper-1",
    origin: "local",
    zotero_key: null,
    type: "highlight",
    color: "#ffd400",
    text: "quoted",
    comment: "",
    tags: [],
    anchor: { zoteroPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] } },
    page_index: 0,
    sort_index: "00000|000000|00000",
    sync_state: "local",
    zotero_version: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeRunner(calls: Call[], result: Record<string, unknown> = row()): PgRunner {
  return {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return [result];
    },
  } as unknown as PgRunner;
}

function makeRepo(calls: Call[], result?: Record<string, unknown>, projectId: string | null = PROJECT) {
  return new PostgresReaderAnnotationRepository(
    fakeRunner(calls, result),
    { projectId } as never,
    { getCurrentUserId: async () => UID, requireUserId: async () => UID },
  );
}

test("every statement is scoped by auth.uid() as well as project", async () => {
  // RLS is the real boundary, but the predicate is also written explicitly so
  // a misconfigured policy cannot silently widen these queries.
  const calls: Call[] = [];
  const repo = makeRepo(calls);
  await repo.list("paper-1");
  await repo.update("ann-1", { comment: "x" });
  await repo.remove("ann-1");
  for (const call of calls) {
    assert.match(call.sql, /user_id = auth\.uid\(\)/, call.sql.slice(0, 60));
    assert.match(call.sql, /project_id = \$1/);
  }
});

test("update leaves a local-only annotation's sync state alone", async () => {
  // Mirrors the Supabase repository: 'pending' means "owes Zotero a
  // write-back", which a row with no zotero_key can never clear.
  const calls: Call[] = [];
  const repo = makeRepo(calls);
  await repo.update("ann-1", { comment: "note" });
  assert.match(
    calls[0]!.sql,
    /sync_state = case when zotero_key is null then sync_state else 'pending' end/,
  );
  assert.doesNotMatch(calls[0]!.sql, /sync_state = 'pending',/);
});

test("update falls back to the default colour rather than writing a blank", async () => {
  const calls: Call[] = [];
  const repo = makeRepo(calls);
  await repo.update("ann-1", { color: "   " });
  // $3 is the colour parameter.
  assert.equal(calls[0]!.params[2], "#ffd400");
});

test("update passes null for untouched fields so coalesce keeps them", async () => {
  const calls: Call[] = [];
  const repo = makeRepo(calls);
  await repo.update("ann-1", { comment: "only this" });
  const [, , color, text, comment, tags, anchor, sortIndex] = calls[0]!.params;
  assert.equal(color, null);
  assert.equal(text, null);
  assert.equal(comment, "only this");
  assert.equal(tags, null);
  assert.equal(anchor, null);
  assert.equal(sortIndex, null);
});

test("update can clear a comment to empty without it being treated as absent", async () => {
  const calls: Call[] = [];
  const repo = makeRepo(calls);
  await repo.update("ann-1", { comment: "   " });
  // Empty string, not null — coalesce must write it through.
  assert.equal(calls[0]!.params[4], "");
});

test("create rejects a type outside Zotero's set before issuing SQL", async () => {
  const calls: Call[] = [];
  const repo = makeRepo(calls);
  await assert.rejects(
    () =>
      repo.create("paper-1", {
        type: "strikeout" as never,
        color: "#ffd400",
        pageIndex: 0,
        anchor: {},
      }),
    /Invalid annotation type/,
  );
  assert.equal(calls.length, 0);
});

test("create serialises the anchor as jsonb and defaults the sort index", async () => {
  const calls: Call[] = [];
  const repo = makeRepo(calls);
  const anchor = { zoteroPosition: { pageIndex: 4, paths: [[1, 2, 3, 4]] } };
  await repo.create("paper-1", { type: "ink", color: "#ff6666", pageIndex: 4, anchor });
  assert.match(calls[0]!.sql, /\$9::jsonb/);
  // $1..$11 = user, project, paper, type, color, text, comment, tags,
  // anchor, page_index, sort_index ('local' is inlined in the statement).
  assert.equal(calls[0]!.params[8], JSON.stringify(anchor));
  assert.equal(calls[0]!.params[9], 4);
  assert.equal(calls[0]!.params[10], "00004|000000|00000");
});

test("update surfaces a missing row instead of returning undefined", async () => {
  const repo = new PostgresReaderAnnotationRepository(
    { async query() { return []; } } as unknown as PgRunner,
    { projectId: PROJECT } as never,
    { getCurrentUserId: async () => UID, requireUserId: async () => UID },
  );
  await assert.rejects(() => repo.update("missing", { comment: "x" }), /not found/);
});

test("a store row with an unknown type fails loudly rather than rendering wrong", async () => {
  const repo = makeRepo([], row({ type: "strikeout" }));
  await assert.rejects(() => repo.list("paper-1"), /Invalid annotation type in store/);
});

test("list returns empty without a project rather than throwing", async () => {
  const repo = makeRepo([], row(), null);
  assert.deepEqual(await repo.list("paper-1"), []);
});
