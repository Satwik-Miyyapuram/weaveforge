import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictError } from "@weaveforge/core";
import { MemorySink } from "../infrastructure/memory-sink";
import { archivePath, createArchiveWriter } from "../infrastructure/kind-writer-archive";
import { sameRows } from "../application/verify-export";
import type { Row } from "../domain/ports";

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

test("plain integration fields are archived; secret-named and nested ones are not", async () => {
  const sink = new MemorySink();
  const writer = createArchiveWriter(sink, ["settings"]);
  const row: Row = {
    userId: "u1",
    integrations: { zotero: { collection: "C1", apiKey: "zk2", nested: { token: "t" } }, github: { pat: "p", repo: "a/b" }, bad: "x" },
  };
  await writer.write("settings", row);
  const back = await writer.readBack("settings");
  assert.deepEqual(back[0]?.integrations, { zotero: { collection: "C1" }, github: { repo: "a/b" } });
  const text = await sink.readText(archivePath("settings"));
  for (const secret of ["zk2", '"t"', '"p"']) assert.ok(!text.includes(secret), secret);
  assert.ok(sameRows("settings", [row], back));
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
