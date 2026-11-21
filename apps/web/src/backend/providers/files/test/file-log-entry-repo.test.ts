import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { LogEntry } from "@weaveforge/core";
import { LogEntryValidationError, NotFoundError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileLogEntryRepository } from "../file-log-entry-repo";

before(loadTestCore);

function entry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    id: crypto.randomUUID(),
    entryDate: "2026-06-24",
    kind: "daily",
    body: "Read three papers on latent diffusion.",
    links: [],
    createdAt: "2026-06-24T00:00:00.000Z",
    ...over,
  };
}

function setup() {
  const fs = new MemoryWorkspaceFs();
  return { fs, repo: new FileLogEntryRepository(fs, () => "thesis") };
}

async function files(fs: MemoryWorkspaceFs): Promise<string[]> {
  const out: string[] = [];
  for await (const e of fs.walk("")) if (e.kind === "file") out.push(e.path);
  return out.sort();
}

test("T4: save then getById returns the entry unchanged; absent is null", async () => {
  const { repo } = setup();
  const e = entry({ body: "Ünïcode β-VAE\n\n- point", links: [{ type: "experiment", id: "x1" }] });
  await repo.save(e);
  assert.deepEqual(await repo.getById(e.id), e);
  assert.equal(await repo.getById("nope"), null);
});

test("files sit in logbook/YYYY/MM under the project", async () => {
  const { fs, repo } = setup();
  await repo.save(entry());
  const [path] = await files(fs);
  assert.match(path ?? "", /^thesis\/logbook\/2026\/06\/2026-06-24--.+\.log\.md$/);
});

test("list filters by kind, inclusive date range and body text", async () => {
  const { repo } = setup();
  const w = entry({ kind: "weekly", entryDate: "2026-06-15", body: "Trained the VAE" });
  await repo.save(w);
  await repo.save(entry({ entryDate: "2026-06-01", body: "Wrote intro" }));
  await repo.save(entry({ entryDate: "2026-06-30", body: "vae again" }));
  assert.deepEqual((await repo.list({ kind: "weekly" })).map((e) => e.id), [w.id]);
  assert.deepEqual((await repo.list({ dateFrom: "2026-06-15", dateTo: "2026-06-15" })).map((e) => e.id), [w.id]);
  assert.equal((await repo.list({ bodyContains: "VAE" })).length, 2);
});

test("list is newest entryDate first, then newest createdAt", async () => {
  const { repo } = setup();
  const old = entry({ entryDate: "2026-06-01" });
  const a = entry({ entryDate: "2026-06-20", createdAt: "2026-06-20T08:00:00.000Z" });
  const b = entry({ entryDate: "2026-06-20", createdAt: "2026-06-20T09:00:00.000Z" });
  for (const e of [old, a, b]) await repo.save(e);
  assert.deepEqual((await repo.list()).map((e) => e.id), [b.id, a.id, old.id]);
});

test("save is an upsert on id; two entries on one day get two files", async () => {
  const { fs, repo } = setup();
  const a = entry({ body: "v1" });
  await repo.save(a);
  await repo.save({ ...a, body: "v2" });
  await repo.save(entry());
  assert.equal((await repo.getById(a.id))?.body, "v2");
  assert.equal((await files(fs)).length, 2);
});

test("add trims, defaults and writes; a blank body is a LogEntryValidationError", async () => {
  const { repo } = setup();
  const made = await repo.add({ body: "  did things  ", entryDate: "2026-01-02" });
  assert.equal(made.body, "did things");
  assert.equal(made.kind, "daily");
  assert.deepEqual(await repo.getById(made.id), made);
  await assert.rejects(repo.add({ body: "   " }), LogEntryValidationError);
});

test("update keeps id, date and createdAt; checks the body and the id", async () => {
  const { repo } = setup();
  const e = entry();
  await repo.save(e);
  const got = await repo.update(e.id, { body: "  new  ", kind: "weekly" });
  assert.deepEqual(got, { ...e, body: "new", kind: "weekly" });
  assert.deepEqual(await repo.getById(e.id), got);
  await assert.rejects(repo.update(e.id, { body: " ", kind: "daily" }), LogEntryValidationError);
  await assert.rejects(repo.update("missing", { body: "x", kind: "daily" }), NotFoundError);
});

test("remove and delete move the file to the trash", async () => {
  const { fs, repo } = setup();
  const a = entry();
  const b = entry();
  await repo.save(a);
  await repo.save(b);
  await repo.remove(a.id);
  await repo.delete(b.id);
  assert.deepEqual(await repo.list(), []);
  assert.ok((await files(fs)).every((p) => p.startsWith(".weaveforge/trash/")));
});

test("reads a hand-written Obsidian log file", async () => {
  const { fs, repo } = setup();
  await fs.writeFile(
    "thesis/logbook/2026/03/2026-03-04--abc.log.md",
    "---\nweaveforge-id: abc\nweaveforge-type: log_entry\nentry-date: 2026-03-04\nkind: daily\ncreated-at: 2026-03-04T10:00:00Z\n---\nWrote by hand.\n",
  );
  const got = await repo.getById("abc");
  assert.equal(got?.body, "Wrote by hand.");
  assert.equal(got?.entryDate, "2026-03-04");
});
