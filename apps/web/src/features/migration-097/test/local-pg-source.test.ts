import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalPgSource, type ReadPage } from "../infrastructure/local-pg-source";
import { TABLE_BY_KIND } from "../infrastructure/postgrest-source";

type Call = { kind: string; after: readonly unknown[] | null; limit: number };

// Fake of the bridge's migrate097Read: pages a fixed list of rows by key, like the Rust read_page does.
function fakeRead(rows: Record<string, Record<string, unknown>[]>): { read: ReadPage; calls: Call[] } {
  const calls: Call[] = [];
  const read: ReadPage = async (kind, after, limit) => {
    calls.push({ kind, after, limit });
    const all = rows[kind] ?? [];
    if (after === null) return all.slice(0, limit);
    const idx = all.findIndex((r) => r.id === after[0]);
    // An unknown cursor reads as the end, so a fake without `id` cannot loop forever.
    if (idx < 0) return [];
    return all.slice(idx + 1, idx + 1 + limit);
  };
  return { read, calls };
}

test("every exporter kind (TABLE_BY_KIND) is readable: none is refused as unknown", async () => {
  const { read } = fakeRead({});
  const source = new LocalPgSource({ read });
  for (const kind of Object.keys(TABLE_BY_KIND)) {
    await assert.doesNotReject(source.listRows(kind), kind);
  }
});

test("ink is file-only: no rows and no trash", async () => {
  const { read, calls } = fakeRead({});
  const source = new LocalPgSource({ read });
  assert.deepEqual(await source.listRows("ink"), []);
  assert.deepEqual(await source.listTrashed("ink"), []);
  assert.equal(calls.length, 0);
});

test("unknown kind is refused, not read", async () => {
  const { read, calls } = fakeRead({});
  const source = new LocalPgSource({ read });
  await assert.rejects(source.listRows("nope"), /unknown kind: nope/);
  assert.equal(calls.length, 0);
});

test("listRows drops soft-deleted rows for soft-delete tables and camel-cases the rest", async () => {
  const { read } = fakeRead({
    papers: [
      { id: "p1", paper_id: "x", deleted_at: null },
      { id: "p2", paper_id: "y", deleted_at: "2026-11-01T00:00:00Z" },
    ],
  });
  const source = new LocalPgSource({ read });
  assert.deepEqual(await source.listRows("papers"), [{ id: "p1", paperId: "x", deletedAt: null }]);
});

test("listTrashed returns only soft-deleted rows, camel-cased", async () => {
  const { read } = fakeRead({
    papers: [
      { id: "p1", paper_id: "x", deleted_at: null },
      { id: "p2", paper_id: "y", deleted_at: "2026-11-01T00:00:00Z" },
    ],
  });
  const source = new LocalPgSource({ read });
  assert.deepEqual(await source.listTrashed("papers"), [
    { id: "p2", paperId: "y", deletedAt: "2026-11-01T00:00:00Z" },
  ]);
});

test("tables without deleted_at have no trash and keep every row", async () => {
  const { read } = fakeRead({ settings: [{ user_id: "u1", theme_name: "crt" }] });
  const source = new LocalPgSource({ read });
  assert.deepEqual(await source.listTrashed("settings"), []);
  assert.deepEqual(await source.listRows("settings"), [{ userId: "u1", themeName: "crt" }]);
});

test("paging: each page cursors on the last row's key, stops on a short page, cap is 1000", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, body: i }));
  const { read, calls } = fakeRead({ notes: rows });
  const source = new LocalPgSource({ read, pageSize: 2 });
  const got = await source.listRows("notes");
  assert.equal(got.length, 5);
  assert.deepEqual(
    calls.map((c) => c.after),
    [null, ["n1"], ["n3"]],
  );
  assert.ok(calls.every((c) => c.limit === 2));
});

test("a page size above the shell's 1000 cap is clamped, so a clamped full page does not end the listing", async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `n${String(i).padStart(4, "0")}` }));
  const inner = fakeRead({ notes: rows });
  const read: ReadPage = (kind, after, limit) => inner.read(kind, after, Math.min(limit, 1000));
  assert.equal((await new LocalPgSource({ read, pageSize: 2000 }).listRows("notes")).length, 1500);
  assert.ok(inner.calls.every((c) => c.limit === 1000));
});

test("default page size is the 1000-row cap the shell enforces", async () => {
  const { read, calls } = fakeRead({ notes: [] });
  await new LocalPgSource({ read }).listRows("notes");
  assert.equal(calls[0]?.limit, 1000);
});

test("composite key (metrics) cursors on all three columns", async () => {
  const calls: Call[] = [];
  const pages: Record<string, unknown>[][] = [
    [{ experiment_id: "e1", metric: "loss", step: 1 }],
    [{ experiment_id: "e1", metric: "loss", step: 2 }],
    [],
  ];
  const read: ReadPage = async (kind, after, limit) => {
    calls.push({ kind, after, limit });
    return pages[calls.length - 1] ?? [];
  };
  await new LocalPgSource({ read, pageSize: 1 }).listRows("metrics");
  assert.deepEqual(calls.map((c) => c.after), [null, ["e1", "loss", 1], ["e1", "loss", 2]]);
});

test("a refused read rejects the whole listing (no partial rows)", async () => {
  const read: ReadPage = async (_kind, after) => {
    if (after === null) return [{ id: "n1", body: 1 }];
    throw new Error("write refused: 25006");
  };
  const source = new LocalPgSource({ read, pageSize: 1 });
  await assert.rejects(source.listRows("notes"), /25006/);
});

test("a page that does not move the cursor past its last key rejects instead of looping", async () => {
  let reads = 0;
  const read: ReadPage = async () => {
    reads += 1;
    return [{ id: "n0" }, { id: "n1" }];
  };
  await assert.rejects(new LocalPgSource({ read, pageSize: 2 }).listRows("notes"), /cursor did not advance/);
  assert.equal(reads, 2);
});

test("an exact multiple of the page size stops on the empty page after it", async () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}` }));
  const { read, calls } = fakeRead({ notes: rows });
  assert.equal((await new LocalPgSource({ read, pageSize: 2 }).listRows("notes")).length, 4);
  assert.deepEqual(calls.map((c) => c.after), [null, ["n1"], ["n3"]]);
});

test("a null or missing key value rejects instead of paging on it", async () => {
  for (const last of [{ id: null }, { body: 1 }]) {
    const read: ReadPage = async () => [{ id: "n0" }, last];
    await assert.rejects(new LocalPgSource({ read, pageSize: 2 }).listRows("notes"), /key id is missing/);
  }
  const metrics: ReadPage = async () => [{ experiment_id: "e1", metric: "loss", step: undefined }];
  await assert.rejects(new LocalPgSource({ read: metrics, pageSize: 1 }).listRows("metrics"), /key step is missing/);
});

test("countRows, listRows and listTrashed read each kind once per run, so they see the same rows", async () => {
  const { read, calls } = fakeRead({
    papers: [
      { id: "p1", deleted_at: null },
      { id: "p2", deleted_at: "2026-11-01T00:00:00Z" },
    ],
  });
  const source = new LocalPgSource({ read });
  assert.equal(await source.countRows("papers"), 1);
  assert.equal((await source.listRows("papers")).length, 1);
  assert.equal((await source.listTrashed("papers")).length, 1);
  assert.equal(calls.filter((c) => c.kind === "papers").length, 1);
});

test("a failed read is not cached: the next listing reads again", async () => {
  let reads = 0;
  const read: ReadPage = async () => {
    reads += 1;
    if (reads === 1) throw new Error("busy");
    return [];
  };
  const source = new LocalPgSource({ read });
  await assert.rejects(source.listRows("notes"), /busy/);
  assert.deepEqual(await source.listRows("notes"), []);
  assert.equal(reads, 2);
});

test("countRows is the live row count the listing returned", async () => {
  const { read } = fakeRead({
    papers: [
      { id: "p1", deleted_at: null },
      { id: "p2", deleted_at: "2026-11-01T00:00:00Z" },
    ],
  });
  assert.equal(await new LocalPgSource({ read }).countRows("papers"), 1);
});

test("undecryptable counts live and trashed rows that still carry ciphertext (0099 dropped content_enc)", async () => {
  const { read } = fakeRead({
    papers: [
      { id: "p1", deleted_at: null },
      { id: "p2", deleted_at: null, content_enc: "x" },
      { id: "p3", deleted_at: "2026-11-01T00:00:00Z", list_content_enc: "y" },
      { id: "p4", deleted_at: null, content_enc: null },
    ],
    settings: [{ user_id: "u1" }],
  });
  const source = new LocalPgSource({ read });
  assert.equal(await source.undecryptable("papers"), 2);
  assert.equal(await source.undecryptable("settings"), 0);
  assert.equal(await source.undecryptable("ink"), 0);
});

test("listBlobs maps size_bytes to sizeBytes", async () => {
  const { read, calls } = fakeRead({
    blobs: [{ id: "b1", bucket: "scans", path: "a.pdf", size_bytes: 42 }],
  });
  const refs = await new LocalPgSource({ read }).listBlobs();
  assert.deepEqual(refs, [{ bucket: "scans", path: "a.pdf", sizeBytes: 42 }]);
  assert.equal(calls[0]?.kind, "blobs");
});

test("options that need the old database's other paths throw until wired", async () => {
  const { read } = fakeRead({});
  const source = new LocalPgSource({ read });
  await assert.rejects(source.pendingOutbox(), /not wired/);
  await assert.rejects(source.secretProviders(), /not wired/);
  await assert.rejects(source.fetchBlob({ bucket: "b", path: "p", sizeBytes: 1 }), /not wired/);
  await assert.rejects(source.markExported097(), /not wired/);
});

test("wired options are delegated", async () => {
  const { read } = fakeRead({});
  const source = new LocalPgSource({
    read,
    pendingOutbox: async () => 3,
    secretProviders: async () => ["openai"],
  });
  assert.equal(await source.pendingOutbox(), 3);
  assert.deepEqual(await source.secretProviders(), ["openai"]);
});
