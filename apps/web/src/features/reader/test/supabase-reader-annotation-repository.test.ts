import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseReaderAnnotationRepository } from "../infrastructure/supabase-reader-annotation-repository";

const UID = "user-1";
const PROJECT = "project-1";

interface UpdateCall {
  payload: Record<string, unknown>;
}

interface Recorder {
  updates: UpdateCall[];
  inserts: Record<string, unknown>[];
}

function recorder(): Recorder {
  return { updates: [], inserts: [] };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "ann-1",
    paper_id: "paper-1",
    origin: "local" as const,
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

/**
 * Records every `update` payload and replays a stored row back, merging the
 * payload so a follow-up update observes the previous one.
 */
function fakeDb(stored: Record<string, unknown>, rec: Recorder): SupabaseClient {
  let current = { ...stored };
  return {
    from() {
      const builder: Record<string, unknown> = {
        single: async () => ({ data: current, error: null }),
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        update(payload: Record<string, unknown>) {
          rec.updates.push({ payload });
          current = { ...current, ...payload };
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          rec.inserts.push(payload);
          current = { ...current, ...payload };
          return builder;
        },
        delete: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [current], error: null }).then(resolve),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function makeRepo(stored: Record<string, unknown>, rec: Recorder, projectId: string | null = PROJECT) {
  return new SupabaseReaderAnnotationRepository(
    fakeDb(stored, rec),
    { projectId } as never,
    { getCurrentUserId: async () => UID, requireUserId: async () => UID },
  );
}

test("update leaves a purely local annotation in the local sync state", async () => {
  // `pending` means "owes Zotero a write-back". A row with no Zotero
  // counterpart can never clear that state, so the sidebar would show a
  // permanent, meaningless "pending ·" badge on every local highlight.
  const rec = recorder();
  const repo = makeRepo(row(), rec);

  const updated = await repo.update("ann-1", { comment: "my note" });

  assert.equal(updated.syncState, "local");
  assert.equal(rec.updates.length, 1, "no second write to flag a non-existent divergence");
  assert.equal("sync_state" in rec.updates[0]!.payload, false);
  assert.equal(rec.updates[0]!.payload.comment, "my note");
});

test("update marks a Zotero-backed annotation pending", async () => {
  const rec = recorder();
  const repo = makeRepo(row({ zotero_key: "ABCD1234", origin: "zotero" }), rec);

  const updated = await repo.update("ann-1", { comment: "edited" });

  assert.equal(updated.syncState, "pending");
  assert.equal(rec.updates.length, 2);
  assert.deepEqual(rec.updates[1]!.payload, { sync_state: "pending" });
});

test("update trims text fields and passes the anchor through untouched", async () => {
  const rec = recorder();
  const repo = makeRepo(row(), rec);
  const anchor = { zoteroPosition: { pageIndex: 3, paths: [[1, 2, 3, 4]] } };

  await repo.update("ann-1", { comment: "  spaced  ", color: "   ", anchor });

  assert.equal(rec.updates[0]!.payload.comment, "spaced");
  // An empty colour must not be written as empty — the column has a default.
  assert.equal(rec.updates[0]!.payload.color, "#ffd400");
  assert.deepEqual(rec.updates[0]!.payload.anchor, anchor);
});

test("create rejects a type outside Zotero's set before touching the database", async () => {
  const rec = recorder();
  const repo = makeRepo(row(), rec);

  await assert.rejects(
    () =>
      repo.create("paper-1", {
        // `strikeout` is not a Zotero annotation type — it must never be stored.
        type: "strikeout" as never,
        color: "#ffd400",
        pageIndex: 0,
        anchor: {},
      }),
    /Invalid annotation type/,
  );
  assert.equal(rec.inserts.length, 0);
});

test("create defaults the sort index from the page when the draft omits one", async () => {
  const rec = recorder();
  const repo = makeRepo(row(), rec);

  await repo.create("paper-1", {
    type: "ink",
    color: "#ff6666",
    pageIndex: 4,
    anchor: { zoteroPosition: { pageIndex: 4, paths: [[1, 2, 3, 4]] } },
  });

  const inserted = rec.inserts[0]!;
  assert.equal(inserted.sort_index, "00004|000000|00000");
  assert.equal(inserted.origin, "local");
  assert.equal(inserted.sync_state, "local");
  assert.equal(inserted.user_id, UID);
  assert.equal(inserted.project_id, PROJECT);
});

test("list returns an empty array rather than throwing without a project", async () => {
  const repo = makeRepo(row(), recorder(), null);
  assert.deepEqual(await repo.list("paper-1"), []);
});
