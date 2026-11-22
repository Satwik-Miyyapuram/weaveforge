import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { typedCore } from "@/lib/rust-core";
import type { Row } from "../domain/ports";
import { createFileStore, guardedSink } from "../application/file-store";
import { createPaperFieldsWriter } from "../infrastructure/kind-writer-paper-fields";
import { MemorySink } from "../infrastructure/memory-sink";

before(loadTestCore);

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
  const guarded = guardedSink(sink, await createFileStore(sink, {}));
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
