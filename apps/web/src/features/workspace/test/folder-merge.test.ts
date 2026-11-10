import assert from "node:assert/strict";
import test, { before } from "node:test";
import type {
  ImportDiffEntry,
} from "@weaveforge/wasm";
import { readyCore, type RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { mergeBothChanged, settleConflict } from "../application/folder-merge";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

/**
 * The conflict policy for a note both sides edited.
 *
 * The two rules under test are the ones that make this git-shaped rather than a
 * prompt: a key only one side moved is never asked about, and a choice per key
 * and per hunk composes a whole note rather than picking a whole file.
 */
const ID = "11111111-1111-4111-8111-111111111111";
const PATH = "notes/method--111111.note.md";

function note(fields: Record<string, string>, body: string): string {
  return [
    "---",
    `weaveforge-id: ${ID}`,
    "weaveforge-type: vault_page",
    `title: ${fields.title ?? "Method"}`,
    ...Object.entries(fields)
      .filter(([key]) => key !== "title")
      .map(([key, value]) => `${key}: ${value}`),
    "---",
    body,
  ].join("\n");
}

/** The entry the folder import would build for a file both sides changed. */
function entry(folderContent: string): ImportDiffEntry {
  const [entity] = rs.parseWorkspaceFolder({ [PATH]: folderContent });
  return { action: "conflict", kind: "both-changed", entity: entity! };
}

test("a key only one side moved is settled without asking", () => {
  const base = rs.vaultPageBase(PATH, note({ status: "draft" }, "Base body."))!;
  // The folder retagged it; we only rewrote the body.
  const folder = note({ status: "review" }, "Folder body.");
  const workspace = note({ status: "draft" }, "Workspace body.");

  const merged = mergeBothChanged(rs, entry(folder), base, workspace);

  // The one-sided field change is taken; only the body is left to ask about.
  assert.deepEqual(merged.conflictFields, ["body"]);
  assert.equal(merged.merge?.fields.status, "review");
  assert.equal(merged.merge?.disputed.length, 0);
  assert.deepEqual(merged.merge?.bodySides, {
    ours: "Workspace body.",
    theirs: "Folder body.",
  });
});

test("nothing collides means no conflict at all", () => {
  const base = rs.vaultPageBase(PATH, note({ status: "draft" }, "Base body."))!;
  // They retagged it, we rewrote the body: two edits, one note.
  const folder = note({ status: "review" }, "Base body.");
  const workspace = note({ status: "draft" }, "Workspace body.");

  const merged = mergeBothChanged(rs, entry(folder), base, workspace);

  assert.equal(merged.action, "updated");
  assert.equal(merged.kind, undefined);
  assert.equal(merged.entity.fields.status, "review");
  assert.equal(merged.entity.body, "Workspace body.");
});

test("a key both sides moved is a dispute, shown with its base", () => {
  const base = rs.vaultPageBase(PATH, note({ status: "draft" }, "Base body."))!;
  const merged = mergeBothChanged(
    rs,
    entry(note({ status: "review" }, "Base body.")),
    base,
    note({ status: "published" }, "Base body."),
  );

  assert.deepEqual(merged.conflictFields, ["status"]);
  assert.deepEqual(merged.merge?.disputed, [
    { field: "status", base: "draft", ours: "published", theirs: "review" },
  ]);
});

test("a key one side deleted is absent, not null, when that side is picked", () => {
  const base = rs.vaultPageBase(PATH, note({ status: "draft" }, "Base body."))!;
  // The folder dropped the key; this app changed it.
  const conflicted = mergeBothChanged(
    rs,
    entry(note({}, "Base body.")),
    base,
    note({ status: "published" }, "Base body."),
  );
  assert.deepEqual(conflicted.merge?.disputed, [
    // Rust reports a deleted side as null; picking it still leaves the key absent (below).
    { field: "status", base: "draft", ours: "published", theirs: null },
  ]);

  const settled = settleConflict(rs, conflicted, { [PATH]: { kind: "picks", fields: { status: "theirs" } } });

  assert.equal(settled?.entity.fields.status, undefined);
});

test("a choice per key and per hunk composes one note", () => {
  const base = rs.vaultPageBase(PATH, note({ status: "draft" }, "We ran three seeds.\nHeld."))!;
  const folder = note({ status: "review" }, "We ran five seeds.\nHeld.");
  const workspace = note({ status: "published" }, "We ran three seeds.\nHeld.");
  const conflicted = mergeBothChanged(rs, entry(folder), base, workspace);
  assert.equal(conflicted.action, "conflict");

  // Their status, their seed count, and the rest of this app's copy.
  const settled = settleConflict(
    rs,
    conflicted,
    { [PATH]: { kind: "picks", fields: { status: "theirs" }, hunks: { 0: "theirs" } } },
  );

  assert.ok(settled);
  assert.equal(settled.action, "updated");
  assert.equal(settled.entity.fields.status, "review");
  assert.equal(settled.entity.body, readyCore().mergeHunks(workspace.split("---\n")[2]!, folder.split("---\n")[2]!, { 0: "theirs" }));
  assert.match(settled.entity.body, /We ran five seeds\./);
});

test("an unchosen key keeps this app's copy", () => {
  const base = rs.vaultPageBase(PATH, note({ status: "draft" }, "Base body."))!;
  const conflicted = mergeBothChanged(
    rs,
    entry(note({ status: "review" }, "Base body.")),
    base,
    note({ status: "published" }, "Base body."),
  );

  const settled = settleConflict(rs, conflicted, { [PATH]: { kind: "picks" } });

  assert.equal(settled?.entity.fields.status, "published");
});

test("a file holding markers is never imported, whatever is chosen", () => {
  const base = rs.vaultPageBase(PATH, note({ status: "draft" }, "Base body."))!;
  const conflicted = mergeBothChanged(
    rs,
    entry(note({ status: "review" }, "Base body.")),
    base,
    note({ status: "published" }, "Base body."),
  );

  for (const resolution of ["keep", "folder", "both", "markers"] as const) {
    const marked: ImportDiffEntry = { ...conflicted, kind: "markers" };
    assert.equal(settleConflict(rs, marked, { [PATH]: resolution }), null, resolution);
  }
  const markedWithPicks: ImportDiffEntry = { ...conflicted, kind: "markers" };
  assert.equal(settleConflict(rs, markedWithPicks, { [PATH]: { kind: "picks" } }), null);
});

test("writing markers imports nothing", () => {
  const base = rs.vaultPageBase(PATH, note({ status: "draft" }, "Base body."))!;
  const conflicted = mergeBothChanged(
    rs,
    entry(note({ status: "review" }, "Folder body.")),
    base,
    note({ status: "draft" }, "Workspace body."),
  );

  assert.equal(settleConflict(rs, conflicted, { [PATH]: "markers" }), null);
});

test("the whole-file shortcuts still mean what they meant", () => {
  const base = rs.vaultPageBase(PATH, note({ status: "draft" }, "Base body."))!;
  const conflicted = mergeBothChanged(
    rs,
    entry(note({ status: "review" }, "Folder body.")),
    base,
    note({ status: "draft" }, "Workspace body."),
  );

  assert.equal(settleConflict(rs, conflicted, {}), null);
  assert.equal(settleConflict(rs, conflicted, { [PATH]: "keep" }), null);
  assert.equal(settleConflict(rs, conflicted, { [PATH]: "folder" })?.action, "updated");
  const both = settleConflict(rs, conflicted, { [PATH]: "both" });
  assert.equal(both?.action, "created");
  assert.equal(both?.entity.id, undefined);
  assert.match(both?.entity.title ?? "", /\(from folder\)$/);
});

test("a note over the WASM limit stays a conflict", () => {
  const big = "x".repeat(16 * 1024 * 1024 + 1);
  const base = rs.vaultPageBase(PATH, note({}, "body"))!;
  const conflicted = entry(note({ status: "b" }, "body"));
  assert.equal(mergeBothChanged(rs, conflicted, base, note({}, big)), conflicted);
});
