import assert from "node:assert/strict";
import { test } from "node:test";

import { digestText, mergeVaultPage } from "../../src/workspace/index.js";

const base = {
  fields: { title: "Draft", tags: ["a"], status: "open" },
  bodyDigest: digestText("the original body"),
};

const unchanged = { fields: { ...base.fields }, body: "the original body" };

test("a tag added out there and a paragraph rewritten in here both survive", () => {
  const merged = mergeVaultPage(
    base,
    { fields: { ...base.fields, tags: ["a", "b"] }, body: "the original body" },
    { fields: { ...base.fields }, body: "a rewritten body" },
  );

  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.fields.tags, ["a", "b"]);
  assert.equal(merged.body, "a rewritten body");
});

test("a body only the folder changed is taken from the folder", () => {
  const merged = mergeVaultPage(base, { ...unchanged, body: "edited in Obsidian" }, unchanged);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.body, "edited in Obsidian");
});

test("a body neither side changed stays put", () => {
  const merged = mergeVaultPage(base, unchanged, unchanged);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.body, "the original body");
});

test("both sides writing the same new body is agreement, not a conflict", () => {
  const merged = mergeVaultPage(
    base,
    { ...unchanged, body: "same new text" },
    { ...unchanged, body: "same new text" },
  );
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.body, "same new text");
});

test("a body both sides rewrote differently is left for a person", () => {
  const merged = mergeVaultPage(
    base,
    { ...unchanged, body: "their rewrite" },
    { ...unchanged, body: "our rewrite" },
  );

  assert.equal(merged.conflicts.length, 1);
  const conflict = merged.conflicts[0]!;
  assert.equal(conflict.field, "body");
  assert.equal(conflict.base, base.bodyDigest);
  assert.equal(conflict.local, digestText("their rewrite"));
  assert.equal(conflict.remote, digestText("our rewrite"));
  // Unsettled keeps what the app already has, as everywhere else here.
  assert.equal(merged.body, "our rewrite");
});

test("a field both sides moved differently is reported with all three sides", () => {
  const merged = mergeVaultPage(
    base,
    { fields: { ...base.fields, status: "done" }, body: "the original body" },
    { fields: { ...base.fields, status: "archived" }, body: "the original body" },
  );

  assert.deepEqual(merged.conflicts, [
    { field: "status", base: "open", local: "done", remote: "archived" },
  ]);
  assert.equal(merged.fields.status, "archived");
});

test("field and body conflicts are reported together", () => {
  const merged = mergeVaultPage(
    base,
    { fields: { ...base.fields, status: "done" }, body: "their rewrite" },
    { fields: { ...base.fields, status: "archived" }, body: "our rewrite" },
  );
  assert.deepEqual(
    merged.conflicts.map((conflict) => conflict.field),
    ["status", "body"],
  );
});

test("a base with no known body digest treats the body as changed on both sides", () => {
  // What a version 1 manifest yields. It must not read as "nobody touched it".
  const merged = mergeVaultPage(
    { fields: base.fields, bodyDigest: "" },
    { ...unchanged, body: "theirs" },
    { ...unchanged, body: "ours" },
  );
  assert.deepEqual(
    merged.conflicts.map((conflict) => conflict.field),
    ["body"],
  );
});
