import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictError } from "@weaveforge/core";
import { MemorySink } from "../infrastructure/memory-sink";
import { archivePath, createArchiveWriter, rowLabel } from "../infrastructure/kind-writer-archive";
import { sameRows } from "../application/verify-export";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { runWebExport } from "../application/run-web-export";
import { onlyReportPath } from "./own-report";

const SCREENING: Row[] = [
  { id: "s2", paperId: "p1", decision: "include", note: null, reviewerId: "u1" },
  { id: "s1", paperId: "p2", decision: "exclude", note: "off topic", reviewerId: "u1", tags: ["a"] },
];

test("archive path is .weaveforge/migration-0.9.7/archive/<kind>.json", () => {
  assert.equal(archivePath("screening"), ".weaveforge/migration-0.9.7/archive/screening.json");
});

test("rows round-trip through the archive file, one entry per row in server order", async () => {
  const sink = new MemorySink();
  const writer = createArchiveWriter(sink, ["screening"]);
  for (const row of SCREENING) await writer.write("screening", row);
  const back = await writer.readBack("screening");
  assert.deepEqual(back, SCREENING);
  const file = JSON.parse(await sink.readText(archivePath("screening"))) as Row[];
  assert.deepEqual(file.map((r) => r.id), ["s2", "s1"]);
  assert.ok(sameRows("screening", SCREENING, back));
});

test("a kind with no rows reads back empty and writes an empty archive", async () => {
  const sink = new MemorySink();
  const writer = createArchiveWriter(sink, ["screening"]);
  assert.deepEqual(await writer.readBack("screening"), []);
  assert.deepEqual(JSON.parse(await sink.readText(archivePath("screening"))), []);
});

test("settings secrets never reach the archive, and verify still passes", async () => {
  const sink = new MemorySink();
  const writer = createArchiveWriter(sink, ["settings"]);
  const row: Row = { userId: "u1", zoteroApiKey: "zk-secret", semanticScholarKey: "ss-secret", credentialsEnc: "enc-secret", integrations: { github: "gh-secret" }, zoteroLibrary: "users/1" };
  await writer.write("settings", row);
  const back = await writer.readBack("settings");
  const text = await sink.readText(archivePath("settings"));
  for (const secret of ["zk-secret", "ss-secret", "enc-secret", "gh-secret"]) assert.ok(!text.includes(secret), secret);
  assert.equal(back[0]?.zoteroLibrary, "users/1");
  assert.ok(sameRows("settings", [row], back));
});

test("the format write gets each row; its error is reported, not thrown, and the row is still archived", async () => {
  const sink = new MemorySink();
  const seen: string[] = [];
  const failed: string[] = [];
  const writer = createArchiveWriter(
    sink,
    ["tags"],
    async (kind, row) => {
      seen.push(`${kind}:${String(row.id)}`);
      if (row.id === "t2") throw new ConflictError("conflict: tag differs");
    },
    (kind, row, err) => failed.push(`${kind}:${String(row.id)}:${err instanceof ConflictError}`),
  );
  await writer.write("tags", { id: "t1", name: "a" });
  await writer.write("tags", { id: "t2", name: "b" });
  assert.deepEqual(seen, ["tags:t1", "tags:t2"]);
  assert.deepEqual(failed, ["tags:t2:true"]);
  assert.deepEqual((await writer.readBack("tags")).map((r) => r.id), ["t1", "t2"]);
});

test("the whole integrations bag stays off disk, plain-looking fields too", async () => {
  const sink = new MemorySink();
  const writer = createArchiveWriter(sink, ["settings"]);
  const row: Row = {
    userId: "u1",
    integrations: { zotero: { library: "users/1", apiKey: "zk2", nested: { token: "t" } }, github: { pat: "p", repo: "a/b" }, bad: "x" },
  };
  await writer.write("settings", row);
  const back = await writer.readBack("settings");
  assert.equal(back[0]?.integrations, undefined);
  const text = await sink.readText(archivePath("settings"));
  for (const secret of ["zk2", '"t"', '"p"', '"x"', "users/1", "a/b"]) assert.ok(!text.includes(secret), secret);
  assert.ok(sameRows("settings", [row], back));
});

test("a credential under a neutral key never reaches the archive, at any depth", async () => {
  const sink = new MemorySink();
  const writer = createArchiveWriter(sink, ["settings"]);
  const row: Row = {
    userId: "u1",
    integrations: {
      zotero: { library: { leak: "lib3" }, webhookUrl: "https://h/wh3", prefs: { dsn: "dsn3" }, list: [{ value: "v3" }] },
      github: { login: "lg3", uri: "https://x:pw3@h" },
    },
  };
  await writer.write("settings", row);
  const back = await writer.readBack("settings");
  assert.equal(back[0]?.integrations, undefined);
  const text = await sink.readText(archivePath("settings"));
  for (const secret of ["lib3", "wh3", "dsn3", "v3", "lg3", "pw3"]) assert.ok(!text.includes(secret), secret);
});

test("a failed format write is listed in archivedOnly with a fixed reason, never the error text", async () => {
  const writer = createArchiveWriter(new MemorySink(), ["tags", "settings"], async (_kind, row) => {
    if (row.id === "t2") throw new ConflictError("conflict: tag differs at tags/secret-path");
    if (row.userId === "u1") throw new Error("disk full sk-live-leak");
  });
  await writer.write("tags", { id: "t1", name: "a" });
  await writer.write("tags", { id: "t2", name: "b" });
  await writer.write("settings", { userId: "u1", zoteroLibrary: "users/1" });
  assert.deepEqual(writer.archivedOnly?.(), [
    { kind: "tags", id: "t2", reason: "conflict" },
    { kind: "settings", id: "u1", reason: "write failed" },
  ]);
});

test("a failed settings write hands onFormatError the stripped row, and an id-less row gets a fixed marker", async () => {
  const seen: Row[] = [];
  const sink = new MemorySink();
  const writer = createArchiveWriter(
    sink,
    ["settings", "tags"],
    async () => {
      throw new Error("disk full");
    },
    (_kind, row) => seen.push(row),
  );
  await writer.write("settings", { userId: "u1", zoteroApiKey: "zk9", integrations: { zotero: { apiKey: "ak9", collection: "C" }, gh: "tok9" } });
  await writer.write("tags", { name: "no id" });
  const text = JSON.stringify(seen) + JSON.stringify(writer.archivedOnly?.());
  for (const secret of ["zk9", "ak9", "tok9"]) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(writer.archivedOnly?.()[1], { kind: "tags", id: "(no id)", reason: "write failed" });
});

test("rowLabel: id, else the *Id key columns joined in name order, never undefined", () => {
  assert.equal(rowLabel({ id: "t1", userId: "u" }), "t1");
  assert.equal(rowLabel({ userId: "u1", annotationId: "a1", color: "red" }), "a1:u1");
  assert.equal(rowLabel({ userId: "u1" }), "u1");
  assert.equal(rowLabel({ name: "x", id: null }), "(no id)");
});

test("archivedOnly reaches the run report and the export result, and does not block verify", async () => {
  const sink = new MemorySink();
  const tags: Row[] = [{ id: "t1", name: "a" }, { id: "t2", name: "b" }];
  const source = {
    listRows: async (kind: string) => (kind === "tags" ? tags : []),
    countRows: async (kind: string) => (kind === "tags" ? tags.length : 0),
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
    secretProviders: async () => [],
  } as unknown as ServerSource;
  const codec = { supports: () => false, toFile: () => null, toRow: () => null } as unknown as FileCodec;
  const result = await runWebExport({
    runDeviceId: "dev-archived-only",
    kinds: ["tags"],
    codec,
    source,
    sink,
    now: "2026-11-23T00:00:00.000Z",
    writers: (s) => [
      createArchiveWriter(s, ["tags"], async (_kind, row) => {
        if (row.id === "t2") throw new ConflictError("conflict: tag differs");
      }),
    ],
  });
  assert.equal(result.state, "verified");
  assert.deepEqual(result.archivedOnly, [{ kind: "tags", id: "t2", reason: "conflict" }]);
  assert.deepEqual(result.run.archivedOnly, [{ kind: "tags", id: "t2", reason: "conflict" }]);
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { runs: { archivedOnly?: unknown }[] };
  assert.deepEqual(report.runs[0]?.archivedOnly, [{ kind: "tags", id: "t2", reason: "conflict" }]);
});

test("the format write never sees a settings secret", async () => {
  const given: Row[] = [];
  const writer = createArchiveWriter(new MemorySink(), ["settings"], async (_kind, row) => {
    given.push(row);
  });
  await writer.write("settings", { userId: "u1", zoteroApiKey: "zk", credentialsEnc: "enc", integrations: {}, zoteroLibrary: "users/1" });
  assert.deepEqual(given, [{ userId: "u1", zoteroLibrary: "users/1" }]);
});

test("a re-run writer overwrites its own archive, not appends", async () => {
  const sink = new MemorySink();
  const first = createArchiveWriter(sink, ["screening"]);
  for (const row of SCREENING) await first.write("screening", row);
  await first.readBack("screening");
  const second = createArchiveWriter(sink, ["screening"]);
  for (const row of SCREENING) await second.write("screening", row);
  assert.equal((await second.readBack("screening")).length, 2);
});

test("a kind the writer does not own is refused", async () => {
  const writer = createArchiveWriter(new MemorySink(), ["screening"]);
  await assert.rejects(writer.write("notes", { id: "n1" }), /unknown kind/);
  await assert.rejects(writer.readBack("notes"), /unknown kind/);
});
