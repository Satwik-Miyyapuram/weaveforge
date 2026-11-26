import assert from "node:assert/strict";
import { test } from "node:test";
import { createFileStore } from "../application/file-store";
import { sha256Hex } from "../domain/hash";
import { MemorySink } from "../infrastructure/memory-sink";

const read = async (sink: MemorySink, path: string) => new TextDecoder().decode(await sink.readBytes(path));

/** The 0.9.7 copy-data case: a note saved by files mode before the upgrade, which the DB version only adds keys to. */
test("a file the DB version only adds keys to keeps its lines and gains the added keys, with no conflict copy", async () => {
  const sink = new MemorySink();
  await sink.write("n.note.md", "---\nweaveforge-id: a\nstatus: to_read\n---\nbody");
  const store = await createFileStore(sink, {});
  const db = '---\nweaveforge-id: "a"\nstatus: "to_read"\norder: 0\n---\nbody\n';

  const held = await store.store("n.note.md", db, await sha256Hex(db));

  const merged = "---\nweaveforge-id: a\nstatus: to_read\norder: 0\n---\nbody";
  assert.equal(held, "n.note.md");
  assert.equal(await read(sink, "n.note.md"), merged);
  assert.deepEqual(store.conflicts, []);
  assert.equal(store.outputs["n.note.md"], await sha256Hex(merged));
  assert.deepEqual((await sink.list()).sort(), ["n.note.md"]);
});

test("a file with a value the DB version changes is kept, and the DB version goes to a conflict copy", async () => {
  const sink = new MemorySink();
  const user = "---\nweaveforge-id: a\nstatus: read\n---\nbody";
  await sink.write("n.note.md", user);
  const store = await createFileStore(sink, {});
  const db = '---\nweaveforge-id: "a"\nstatus: "to_read"\n---\nbody';

  const held = await store.store("n.note.md", db, await sha256Hex(db));

  assert.notEqual(held, "n.note.md");
  assert.equal(await read(sink, "n.note.md"), user);
  assert.deepEqual(store.conflicts, [held]);
});

test("a JSON settings file the DB version only adds keys to takes the DB version in place", async () => {
  const sink = new MemorySink();
  await sink.write("p/.weaveforge/settings.json", '{\n  "tags": {\n    "a": {}\n  }\n}');
  const store = await createFileStore(sink, {});
  const db = '{"tags":{"a":{},"b":{}}}';

  assert.equal(await store.store("p/.weaveforge/settings.json", db, await sha256Hex(db)), "p/.weaveforge/settings.json");
  assert.equal(await read(sink, "p/.weaveforge/settings.json"), db);
  assert.deepEqual(store.conflicts, []);
});

test("an edit landing between the read and the merge is kept: the compare-and-set fails and a copy is written", async () => {
  const sink = new MemorySink();
  await sink.write("n.note.md", "---\nid: a\n---\nbody");
  const racing = Object.assign(Object.create(sink), {
    writeIf: async (path: string, text: string, expected: string) => {
      await sink.write(path, "---\nid: a\n---\nuser edit");
      return sink.writeIf(path, text, expected);
    },
  });
  const store = await createFileStore(racing, {});
  const db = "---\nid: a\norder: 0\n---\nbody";

  const held = await store.store("n.note.md", db, await sha256Hex(db));

  assert.notEqual(held, "n.note.md");
  assert.equal(await read(sink, "n.note.md"), "---\nid: a\n---\nuser edit");
});

/** The 0.9.7 copy-data cases: an alias only the file has, and tags the file holds hyphenated. */
test("a key only the file has, and tags it holds hyphenated, stay as the file wrote them", async () => {
  const sink = new MemorySink();
  const file = '---\nweaveforge-id: a\ntags: [computer-science---ai]\naliases: ["x y"]\n---\nbody';
  await sink.write("e.md", file);
  const store = await createFileStore(sink, {});
  const db = '---\nweaveforge-id: "a"\nwf: 3\ntags: ["computer science - ai"]\n---\nbody\n';

  assert.equal(await store.store("e.md", db, await sha256Hex(db)), "e.md");
  assert.equal(await read(sink, "e.md"), '---\nweaveforge-id: a\ntags: [computer-science---ai]\naliases: ["x y"]\nwf: 3\n---\nbody');
  assert.deepEqual(store.conflicts, []);
});

test("a file the DB version adds nothing to is left as it is and recorded as this run's output", async () => {
  const sink = new MemorySink();
  const file = "---\nweaveforge-id: a\nstatus: to_read\n---\nbody";
  await sink.write("n.md", file);
  const store = await createFileStore(sink, {});
  const db = '---\nweaveforge-id: "a"\nstatus: "to_read"\n---\nbody\n';

  assert.equal(await store.store("n.md", db, await sha256Hex(db)), "n.md");
  assert.equal(await read(sink, "n.md"), file);
  assert.equal(store.outputs["n.md"], await sha256Hex(file));
});

test("a guarded writeIf on a user's file the store merges into in place returns true and records the file as kept", async () => {
  const { guardedSink } = await import("../application/file-store");
  const sink = new MemorySink();
  const file = "---\nweaveforge-id: a\nstatus: read\n---\nbody";
  await sink.write("n.md", file);
  const store = await createFileStore(sink, {});
  const guarded = guardedSink(sink, store);
  // Not add-keys-only against the file (it drops status), but the store keeps the file's status and adds order.
  const db = '---\nweaveforge-id: "a"\norder: 0\n---\nbody';

  assert.equal(await guarded.writeIf("n.md", db, file), true);
  assert.equal(await read(sink, "n.md"), "---\nweaveforge-id: a\nstatus: read\norder: 0\n---\nbody");
  assert.deepEqual(store.kept, ["n.md"]);
  assert.deepEqual(store.conflicts, []);
});

test("a guarded writeIf the store cannot merge still throws a conflict and writes a copy", async () => {
  const { guardedSink } = await import("../application/file-store");
  const sink = new MemorySink();
  const file = "---\nweaveforge-id: a\n---\nuser body";
  await sink.write("n.md", file);
  const store = await createFileStore(sink, {});
  await assert.rejects(guardedSink(sink, store).writeIf("n.md", "---\nweaveforge-id: a\n---\ndb body", file), /conflict/);
  assert.equal(await read(sink, "n.md"), file);
  assert.deepEqual(store.kept, []);
  assert.equal(store.conflicts.length, 1);
});
