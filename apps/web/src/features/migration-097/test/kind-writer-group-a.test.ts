import assert from "node:assert/strict";
import { before, test } from "node:test";
import { ConflictError } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore } from "@/lib/rust-core";
import { sameRows } from "../application/verify-export";
import { createGroupAWriter } from "../infrastructure/kind-writer-group-a";
import type { FileCodec, Row } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";
import { BARE_PAPER_ROW, CHILD_NOTE_ROW, COMMENT_ROWS, NOTE_ROW, PAPER_ROW, USER } from "./group-a-fixtures";

before(loadTestCore);

async function writeAll(sink: MemorySink): Promise<ReturnType<typeof createGroupAWriter>> {
  const writer = createGroupAWriter(sink);
  for (const row of [NOTE_ROW, CHILD_NOTE_ROW]) await writer.write("notes", row);
  for (const row of [PAPER_ROW, BARE_PAPER_ROW]) await writer.write("papers", row);
  for (const row of COMMENT_ROWS) await writer.write("comments", row);
  return writer;
}

test("notes, papers and comments read back as the server rows", async () => {
  const writer = await writeAll(new MemorySink());
  assert.ok(sameRows("notes", [NOTE_ROW, CHILD_NOTE_ROW], await writer.readBack("notes")));
  assert.ok(sameRows("papers", [PAPER_ROW, BARE_PAPER_ROW], await writer.readBack("papers")));
  assert.ok(sameRows("comments", COMMENT_ROWS, await writer.readBack("comments")));
});

test("notes and papers land as app files at the workspace root", async () => {
  const sink = new MemorySink();
  await writeAll(sink);
  const files = await sink.list();
  assert.ok(files.some((p) => /^notes\/reading-plan--.+\.note\.md$/.test(p)), files.join("\n"));
  assert.ok(files.includes("papers/attention-is-all-you-need.paper.md"), files.join("\n"));
  const note = await sink.readText(files.find((p) => p.startsWith("notes/reading-plan"))!);
  assert.match(note, /weaveforge-id: aaaaaaaa-0000-4000-8000-000000000001/);
  assert.doesNotMatch(note, /server|row-?version|user/i);
});

test("a comment sits in the sidecar next to its item, without resourceType or resourceId", async () => {
  const sink = new MemorySink();
  await writeAll(sink);
  const sidecar = readyCore().commentsFilePath("papers/attention-is-all-you-need.paper.md");
  const rows = JSON.parse(await sink.readText(sidecar)) as Record<string, unknown>[];
  assert.deepEqual(
    rows.map((r) => r.id),
    ["cccccccc-0000-4000-8000-000000000001", "cccccccc-0000-4000-8000-000000000002"],
  );
  assert.deepEqual(rows[0], {
    id: "cccccccc-0000-4000-8000-000000000001",
    authorId: USER,
    body: "comment cccccccc-0000-4000-8000-000000000001",
    createdAt: "2026-11-03T09:00:00+00:00",
    anchor: { quote: "sequence transduction", prefix: "The dominant ", suffix: " models" },
  });
  assert.equal(rows[1]?.parentId, "cccccccc-0000-4000-8000-000000000001");
  assert.equal(rows[1]?.resolvedAt, "2026-11-04T09:00:00+00:00");
  const notePath = (await sink.list()).find((p) => p.startsWith("notes/reading-plan"))!;
  const noteRows = JSON.parse(await sink.readText(readyCore().commentsFilePath(notePath))) as { id: string }[];
  assert.deepEqual(noteRows.map((r) => r.id), ["cccccccc-0000-4000-8000-000000000003"]);
});

test("a comment whose item has no local file keeps its item in a fallback file", async () => {
  const sink = new MemorySink();
  await writeAll(sink);
  const path = "comments/log_entry-dddddddd-0000-4000-8000-000000000001.comments.json";
  const rows = JSON.parse(await sink.readText(path)) as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.resourceType, "log_entry");
  assert.equal(rows[0]?.resourceId, "dddddddd-0000-4000-8000-000000000001");
});

test("a second run over the same files changes no byte and still reads back", async () => {
  const sink = new MemorySink();
  await writeAll(sink);
  const before = new Map<string, string>();
  for (const p of await sink.list()) before.set(p, await sink.readText(p));
  const again = await writeAll(sink);
  const after = new Map<string, string>();
  for (const p of await sink.list()) after.set(p, await sink.readText(p));
  assert.deepEqual(after, before);
  assert.ok(sameRows("comments", COMMENT_ROWS, await again.readBack("comments")));
  assert.ok(sameRows("notes", [NOTE_ROW, CHILD_NOTE_ROW], await again.readBack("notes")));
  assert.ok(sameRows("papers", [PAPER_ROW, BARE_PAPER_ROW], await again.readBack("papers")));
});

test("a local comment with the same id and other content is a conflict, not overwritten", async () => {
  const sink = new MemorySink();
  await writeAll(sink);
  const sidecar = readyCore().commentsFilePath("papers/attention-is-all-you-need.paper.md");
  const local = (await sink.readText(sidecar)).replace("comment cccccccc-0000-4000-8000-000000000001", "edited here");
  await sink.write(sidecar, local);
  const writer = createGroupAWriter(sink);
  await writer.write("papers", PAPER_ROW);
  await assert.rejects(writer.write("comments", COMMENT_ROWS[0]!), ConflictError);
  assert.equal(await sink.readText(sidecar), local);
});

test("readBack lists only the rows this run wrote, so local-only notes do not fail the gate", async () => {
  const sink = new MemorySink();
  await writeAll(sink);
  const fresh = createGroupAWriter(sink);
  await fresh.write("notes", NOTE_ROW);
  assert.ok(sameRows("notes", [NOTE_ROW], await fresh.readBack("notes")));
});

test("a server body with CRLF line ends still verifies; the file keeps LF like the app", async () => {
  const sink = new MemorySink();
  const writer = createGroupAWriter(sink);
  const row = { ...NOTE_ROW, body: "a\r\nb\r\n" };
  await writer.write("notes", row);
  assert.ok(sameRows("notes", [row], await writer.readBack("notes")));
  const path = (await sink.list()).find((p) => p.endsWith(".note.md"))!;
  assert.doesNotMatch(await sink.readText(path), /\r/);
});

test("a changed body is not read back as the server row", async () => {
  const writer = createGroupAWriter(new MemorySink());
  await writer.write("notes", NOTE_ROW);
  assert.equal(sameRows("notes", [{ ...NOTE_ROW, body: "other" }], await writer.readBack("notes")), false);
});

test("a paper that differs in any compared field is not read back as the server row", async () => {
  const writer = createGroupAWriter(new MemorySink());
  await writer.write("papers", PAPER_ROW);
  const back = await writer.readBack("papers");
  assert.equal(sameRows("papers", [{ ...PAPER_ROW, authors: ["Someone"] }], back), false);
  assert.equal(sameRows("papers", [{ ...PAPER_ROW, summary: "extra" }], back), false);
  assert.equal(sameRows("papers", [{ ...PAPER_ROW, metadata: {} }], back), false);
});

test("a paper with an upper-case DOI or odd stamps reads back as the server row", async () => {
  const writer = createGroupAWriter(new MemorySink());
  const row = { ...PAPER_ROW, doi: "10.1000/ABC.Def", createdAt: "2026-10-01T08:00:00.000001+00:00", readAt: null };
  await writer.write("papers", row);
  assert.ok(sameRows("papers", [row], await writer.readBack("papers")), JSON.stringify(await writer.readBack("papers")));
});

test("a comment quoting a passage with no prefix or suffix reads back with nulls, not empty strings", async () => {
  const writer = createGroupAWriter(new MemorySink());
  await writer.write("papers", PAPER_ROW);
  const row = { ...COMMENT_ROWS[0]!, anchorPrefix: null, anchorSuffix: null };
  await writer.write("comments", row);
  assert.deepEqual(await writer.readBack("comments"), [row]);
});

test("a server comment anchored at the start of the text (prefix \"\") still verifies", async () => {
  const writer = createGroupAWriter(new MemorySink());
  await writer.write("papers", PAPER_ROW);
  const row = { ...COMMENT_ROWS[0]!, anchorPrefix: "", anchorSuffix: "" };
  await writer.write("comments", row);
  assert.ok(sameRows("comments", [row], await writer.readBack("comments")), JSON.stringify(await writer.readBack("comments")));
});

/** A sink that counts readText calls per path. */
class CountingSink extends MemorySink {
  reads = new Map<string, number>();
  override async readText(path: string): Promise<string> {
    this.reads.set(path, (this.reads.get(path) ?? 0) + 1);
    return super.readText(path);
  }
}

test("many comments on one paper or note read the item files once, not once per comment", async () => {
  const sink = new CountingSink();
  const writer = createGroupAWriter(sink);
  await writer.write("papers", PAPER_ROW);
  await writer.write("notes", NOTE_ROW);
  sink.reads.clear();
  const onPaper = COMMENT_ROWS[0]!;
  const onNote = COMMENT_ROWS.find((r) => r.resourceType === "vault_page")!;
  for (let i = 0; i < 20; i += 1) {
    await writer.write("comments", { ...onPaper, id: `cccccccc-0000-4000-8000-1000000000${String(i).padStart(2, "0")}`, parentId: null });
    await writer.write("comments", { ...onNote, id: `cccccccc-0000-4000-8000-2000000000${String(i).padStart(2, "0")}`, parentId: null });
  }
  const itemReads = [...sink.reads].filter(([p]) => p.endsWith(".paper.md") || p.endsWith(".note.md"));
  for (const [path, n] of itemReads) assert.ok(n <= 1, `${path} read ${n} times`);
});

test("the codec index reads each .md file once and never an asset", async () => {
  const sink = new CountingSink();
  const entryId = "dddddddd-0000-4000-8000-000000000001";
  await sink.write("logbook/2026-11-01--standup.log.md", JSON.stringify({ id: entryId }));
  await sink.write("assets/big.pdf", "%PDF-binary");
  await sink.write("assets/figure.md", "not a codec file");
  const codec: FileCodec = {
    supports: (kind) => kind === "logEntries" || kind === "readingLists",
    toFile: () => {
      throw new Error("unused");
    },
    toRow: (kind, path, text) => (kind === "logEntries" && path.endsWith(".log.md") ? (JSON.parse(text) as Row) : null),
  };
  const writer = createGroupAWriter(sink, codec);
  sink.reads.clear();
  await writer.write("comments", COMMENT_ROWS[3]!);
  await writer.write("comments", { ...COMMENT_ROWS[3]!, resourceType: "reading_list", resourceId: "none", id: "x-1" });
  assert.equal(sink.reads.get("assets/big.pdf") ?? 0, 0);
  assert.equal(sink.reads.get("assets/figure.md") ?? 0, 0);
  assert.equal(sink.reads.get("logbook/2026-11-01--standup.log.md"), 1);
});

test("a comment on a codec item sits next to the item's file, as the app's sidecar", async () => {
  const sink = new MemorySink();
  const entryId = "dddddddd-0000-4000-8000-000000000001";
  await sink.write("log/2026-11-01-standup.md", JSON.stringify({ id: entryId }));
  await sink.write("log/other.md", JSON.stringify({ id: "someone-else" }));
  const codec: FileCodec = {
    supports: (kind) => kind === "logEntries",
    toFile: () => {
      throw new Error("unused");
    },
    toRow: (kind, path, text) => (kind === "logEntries" && path.startsWith("log/") ? (JSON.parse(text) as Row) : null),
  };
  const writer = createGroupAWriter(sink, codec);
  const row = COMMENT_ROWS[3]!;
  await writer.write("comments", row);
  const sidecar = readyCore().commentsFilePath("log/2026-11-01-standup.md");
  const rows = JSON.parse(await sink.readText(sidecar)) as Record<string, unknown>[];
  assert.deepEqual(rows.map((r) => r.id), [row.id]);
  assert.equal(rows[0]?.resourceType, undefined, "the sidecar's item is the file next to it");
  assert.equal((await sink.list()).some((p) => p.startsWith("comments/")), false);
  assert.ok(sameRows("comments", [row], await writer.readBack("comments")));
});

test("a note row with kind \"note\" or a null kind (pre-0157 rows) reads back as the server row", async () => {
  const legacy = { ...CHILD_NOTE_ROW, kind: null };
  const writer = createGroupAWriter(new MemorySink());
  for (const row of [NOTE_ROW, legacy]) await writer.write("notes", row);
  assert.equal(NOTE_ROW.kind, "note");
  assert.ok(sameRows("notes", [NOTE_ROW, legacy], await writer.readBack("notes")));
});

test("a canvas row is not saved as a markdown note", async () => {
  const sink = new MemorySink();
  const writer = createGroupAWriter(sink);
  const canvas = { ...NOTE_ROW, id: "aaaaaaaa-0000-4000-8000-0000000000c1", title: "Board", kind: "canvas", body: '{"nodes":[],"edges":[]}' };
  await writer.write("notes", canvas);
  assert.deepEqual((await sink.list()).filter((p) => p.toLowerCase().includes("board")), ["notes/Board.canvas"]);
});

test("an unknown kind is refused", async () => {
  const writer = createGroupAWriter(new MemorySink());
  await assert.rejects(writer.write("tags", { id: "x" }), /unknown kind/);
});

test("a canvas page lands as notes/<title>.canvas with its body and reads back as its row", async () => {
  const sink = new MemorySink();
  const writer = createGroupAWriter(sink);
  const canvas: Row = { ...NOTE_ROW, id: "canvas-1", title: "test", kind: "canvas", body: '{"nodes":[],"edges":[]}' };
  await writer.write("notes", NOTE_ROW);
  await writer.write("notes", canvas);
  assert.equal(await sink.readText("notes/test.canvas"), canvas.body);
  assert.ok(sameRows("notes", [NOTE_ROW, canvas], await writer.readBack("notes")));
  // A re-run over the same file is a no-op; a differing user file is never overwritten.
  await createGroupAWriter(sink).write("notes", canvas);
  await sink.write("notes/test.canvas", "{}");
  await assert.rejects(createGroupAWriter(sink).write("notes", canvas));
  assert.equal(await sink.readText("notes/test.canvas"), "{}");
});
