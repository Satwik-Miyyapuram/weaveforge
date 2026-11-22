import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { typedCore } from "@/lib/rust-core";
import type { Row } from "../domain/ports";
import { createFileStore, guardedSink } from "../application/file-store";
import { createPaperFieldsWriter } from "../infrastructure/kind-writer-paper-fields";
import { sha256Hex } from "../domain/hash";
import { conflictCopyPath } from "../domain/conflict-path";
import { MemorySink } from "../infrastructure/memory-sink";

before(loadTestCore);

const USER_NOTE = '---\nweaveforge-id: "p1"\nwf: 3\ntitle: "A"\n---\nBody.\n';

const FOLDERS = new Map([
  ["proj-a", "Thesis"],
  ["proj-b", ""],
]);
const PAPER = "Thesis/papers/a.paper.md";
const DEF: Row = { id: "fa", projectId: "proj-a", name: "Venue", kind: "text", options: [], sortOrder: 0 };

/** A sink where another writer edits `path` once, right before the first compare-and-set reaches it. */
class RacySink extends MemorySink {
  raced = false;
  private readonly racePath: string;
  private readonly edit: string;

  constructor(racePath: string, edit: string) {
    super();
    this.racePath = racePath;
    this.edit = edit;
  }

  override async writeIf(path: string, text: string, expected: string): Promise<boolean> {
    if (!this.raced && path === this.racePath) {
      this.raced = true;
      await this.write(path, this.edit);
    }
    return super.writeIf(path, text, expected);
  }
}

test("CAS: writeIf replaces the file only while it still holds the expected text", async () => {
  const sink = new MemorySink();
  await sink.write("a.md", "v1");
  // This device wrote a.md last run and it is unchanged, so the file is ours and the plain CAS applies.
  const guarded = guardedSink(sink, await createFileStore(sink, { "a.md": await sha256Hex("v1") }));
  assert.equal(await guarded.writeIf("a.md", "v2", "v1"), true);
  assert.equal(await sink.readText("a.md"), "v2");
  assert.equal(await guarded.writeIf("a.md", "v3", "stale"), false);
  assert.equal(await sink.readText("a.md"), "v2");
  assert.deepEqual(sink.paths(), ["a.md"], "a CAS mismatch writes no conflict copy");
});

test("CAS mismatch: a user edit between read and write is kept, and the value is retried onto it", async () => {
  const core = typedCore();
  const base = core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n";
  const edited = core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\nUser edit.\n";
  const sink = new RacySink(PAPER, edited);
  await sink.write(PAPER, base);
  const writer = createPaperFieldsWriter(sink, FOLDERS);
  await writer.write("paperFields", DEF);
  await writer.write("paperFieldValues", { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "NeurIPS" });
  assert.equal(sink.raced, true, "the race must actually hit the compare-and-set");
  const text = await sink.readText(PAPER);
  assert.ok(text.includes("User edit."), "the user's edit is kept");
  assert.ok(text.includes("NeurIPS"), "the value lands on the retried text");
  assert.deepEqual(sink.paths().filter((p) => p !== ".weaveforge/settings.json"), [PAPER], "no conflict copy");
});

test("paper field value: a differing value already in the file is kept and reported as a conflict", async () => {
  const core = typedCore();
  const sink = new MemorySink();
  await sink.write(PAPER, core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n");
  const writer = createPaperFieldsWriter(sink, FOLDERS);
  await writer.write("paperFields", DEF);
  await writer.write("paperFieldValues", { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "user" });
  await assert.rejects(
    writer.write("paperFieldValues", { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "NeurIPS" }),
    (err: Error) => err.message.startsWith("conflict:"),
  );
  const text = await sink.readText(PAPER);
  assert.ok(text.includes("user"), "the file's value is kept");
  assert.ok(!text.includes("NeurIPS"), "the differing export value is not written");
});

test("paper field value: the body and the other frontmatter lines stay byte-identical", async () => {
  const core = typedCore();
  const sink = new MemorySink();
  const before = core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n\nSecond paragraph.\n";
  await sink.write(PAPER, before);
  const writer = createPaperFieldsWriter(sink, FOLDERS);
  await writer.write("paperFields", DEF);
  await writer.write("paperFieldValues", { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "NeurIPS" });
  const after = await sink.readText(PAPER);
  assert.ok(after.includes("NeurIPS"), "the missing key was added");
  assert.equal(after.slice(after.indexOf("---", 3)), before.slice(before.indexOf("---", 3)), "body is unchanged");
  for (const line of before.slice(0, before.indexOf("---", 3)).split("\n").filter((l) => l.trim() !== "")) {
    assert.ok(after.split("\n").includes(line), `frontmatter line kept byte-identical: ${line}`);
  }
});

const MULTI: Row = { id: "fm", projectId: "proj-a", name: "Tags", kind: "multi_select", options: ["p1", "p2"], sortOrder: 1 };

test("paper field value: the conflict entry carries the DB value", async () => {
  const core = typedCore();
  const sink = new MemorySink();
  await sink.write(PAPER, core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n");
  const writer = createPaperFieldsWriter(sink, FOLDERS);
  await writer.write("paperFields", DEF);
  await writer.write("paperFieldValues", { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "user" });
  await assert.rejects(
    writer.write("paperFieldValues", { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "NeurIPS" }),
    (err: Error & { conflictValue?: unknown }) => err.message.startsWith("conflict:") && err.conflictValue === "NeurIPS",
  );
});

test("paper field value: the same set in another order is not a conflict, and the file is not rewritten", async () => {
  const core = typedCore();
  const sink = new MemorySink();
  await sink.write(PAPER, core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n");
  const writer = createPaperFieldsWriter(sink, FOLDERS);
  await writer.write("paperFields", MULTI);
  await writer.write("paperFieldValues", { id: "m1", projectId: "proj-a", paperId: "p1", fieldId: "fm", value: ["p2", "p1"] });
  const once = await sink.readText(PAPER);
  // A later run reads the list back in the file's order; the same members must not count as a conflict.
  await createPaperFieldsWriter(sink, FOLDERS).write("paperFieldValues", { id: "m1", projectId: "proj-a", paperId: "p1", fieldId: "fm", value: ["p1", "p2"] });
  assert.equal(await sink.readText(PAPER), once, "an equal set leaves the file as it is");
});

test("two clean runs: a value this device wrote is not mistaken for a user edit on the next run", async () => {
  const core = typedCore();
  const base = core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n";
  const sink = new MemorySink();
  // Run 1: the codec writes the note, then the field merge compare-and-sets over it.
  const store1 = await createFileStore(sink, {});
  const guarded1 = guardedSink(sink, store1);
  await guarded1.write(PAPER, base);
  await createPaperFieldsWriter(guarded1, FOLDERS).write("paperFields", DEF);
  await createPaperFieldsWriter(guarded1, FOLDERS).write("paperFieldValues", { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "NeurIPS" });
  // Run 2: the codec writes the note again from the DB. Nothing differs from what run 1 left, so no copy.
  const store2 = await createFileStore(sink, store1.outputs);
  await guardedSink(sink, store2).write(PAPER, base + "Rewritten.\n");
  assert.deepEqual(store2.conflicts, [], "no conflict copy on a clean re-run");
  assert.deepEqual(sink.paths().filter((p) => p !== ".weaveforge/settings.json"), [PAPER]);
});

test("CAS miss: the conflict check runs again on the re-read text, so a user value written in the race is kept", async () => {
  const core = typedCore();
  const base = core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n";
  // The racing edit is a real file that already holds a differing value for the same field.
  const seed = new MemorySink();
  await seed.write(PAPER, base);
  const seedWriter = createPaperFieldsWriter(seed, FOLDERS);
  await seedWriter.write("paperFields", DEF);
  await seedWriter.write("paperFieldValues", { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "user" });
  const racedText = await seed.readText(PAPER);
  const sink = new RacySink(PAPER, racedText);
  await sink.write(PAPER, base);
  const writer = createPaperFieldsWriter(sink, FOLDERS);
  await writer.write("paperFields", DEF);
  await assert.rejects(
    writer.write("paperFieldValues", { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "NeurIPS" }),
    (err: Error) => err.message.startsWith("conflict:"),
  );
  assert.ok((await sink.readText(PAPER)).includes("user"), "the user's value is not overwritten by the retry");
});

test("P1: a CAS on a user's file never records it as this run's output", async () => {
  const sink = new MemorySink();
  const userNote = '---\nwf: 3\n---\nuser text\n';
  await sink.write("notes.md", userNote);
  const store = await createFileStore(sink, {});
  const guarded = guardedSink(sink, store);
  assert.equal(await guarded.writeIf("notes.md", '---\nwf: 3\nfields: {}\n---\nuser text\n', userNote), true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(store.outputs, "notes.md"),
    false,
    "a file the prior run did not write is not this run's output",
  );
});

test("P1/P2: a CAS on a file this device wrote records the hash of the bytes now on disk", async () => {
  const sink = new MemorySink();
  await sink.write("a.md", "v1");
  const prior = { "a.md": await sha256Hex("v1") };
  const store = await createFileStore(sink, prior);
  assert.equal(await guardedSink(sink, store).writeIf("a.md", "v2", "v1"), true);
  assert.equal(store.outputs["a.md"], await sha256Hex(await sink.readBytes("a.md")));
});

test("same-set re-run: an identical value is a no-op that still reads back as exported, with no conflict", async () => {
  const core = typedCore();
  const base = core.writePaperRow(null, { id: "p1", title: "A" }) + "Body.\n";
  const sink = new MemorySink();
  await sink.write(PAPER, base);
  const value: Row = { id: "v1", projectId: "proj-a", paperId: "p1", fieldId: "fa", value: "NeurIPS" };
  await createPaperFieldsWriter(sink, FOLDERS).write("paperFields", DEF);
  await createPaperFieldsWriter(sink, FOLDERS).write("paperFieldValues", value);
  // Re-run with the identical set: no write, no throw, the value is still in the file.
  await createPaperFieldsWriter(sink, FOLDERS).write("paperFieldValues", value);
  const back = await createPaperFieldsWriter(sink, FOLDERS).readBack("paperFieldValues");
  assert.deepEqual(back.map((r) => r.value), ["NeurIPS"], "the identical row is read back once, as exported");
});

test("add-keys guard: a CAS on a user's file that edits the body is refused and lands in a conflict copy", async () => {
  const sink = new MemorySink();
  await sink.write(PAPER, USER_NOTE);
  const store = await createFileStore(sink, {});
  const guarded = guardedSink(sink, store);
  const edited = USER_NOTE.replace("Body.", "Body changed by the export.");
  assert.equal(await guarded.writeIf(PAPER, edited, USER_NOTE), false, "a body edit on a user file is refused");
  assert.equal(await sink.readText(PAPER), USER_NOTE, "the user's file is untouched");
  assert.equal(await sink.readText(conflictCopyPath(PAPER, 1)), edited, "the refused text is kept in a conflict copy");
  assert.deepEqual(store.conflicts, [conflictCopyPath(PAPER, 1)]);
});

test("add-keys guard: a CAS on a user's file that changes an existing key is refused", async () => {
  const sink = new MemorySink();
  await sink.write(PAPER, USER_NOTE);
  const store = await createFileStore(sink, {});
  const retitled = USER_NOTE.replace('title: "A"', 'title: "B"');
  assert.equal(await guardedSink(sink, store).writeIf(PAPER, retitled, USER_NOTE), false, "an existing key is not rewritten");
  assert.equal(await sink.readText(PAPER), USER_NOTE);
  assert.equal(await sink.readText(conflictCopyPath(PAPER, 1)), retitled);
});

test("add-keys guard: a CAS on a user's file that only adds a frontmatter key is allowed", async () => {
  const sink = new MemorySink();
  await sink.write(PAPER, USER_NOTE);
  const store = await createFileStore(sink, {});
  const withField = USER_NOTE.replace("---\nBody.", 'fields:\n  Venue: "NeurIPS"\n---\nBody.');
  assert.equal(await guardedSink(sink, store).writeIf(PAPER, withField, USER_NOTE), true, "an added key is allowed");
  assert.equal(await sink.readText(PAPER), withField);
  assert.deepEqual(store.conflicts, [], "no conflict copy for an add-keys merge");
});

test("add-keys guard: a second add-keys merge in the same run is allowed, the body and the user's keys stay", async () => {
  const sink = new MemorySink();
  await sink.write(PAPER, USER_NOTE);
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
  const first = USER_NOTE.replace("---\nBody.", 'fields:\n  Venue: "NeurIPS"\n---\nBody.');
  assert.equal(await guarded.writeIf(PAPER, first, USER_NOTE), true);
  const second = first.replace('  Venue: "NeurIPS"', '  Venue: "NeurIPS"\n  Score: 4.5');
  assert.equal(await guarded.writeIf(PAPER, second, first), true, "a field added to the same note in this run is kept");
  const text = await sink.readText(PAPER);
  assert.ok(text.endsWith("---\nBody.\n"), "the body is unchanged");
  assert.ok(text.includes('title: "A"'), "the user's keys are unchanged");
  assert.ok(text.includes("Score: 4.5"));
});
