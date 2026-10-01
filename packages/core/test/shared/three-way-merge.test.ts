import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeRows } from "../../src/shared/three-way-merge.js";

const base = { id: "p1", title: "Draft", read: false, tags: ["a"], row_version: 3 };

describe("the three-way merge", () => {
  it("takes a field only one side changed", () => {
    const result = mergeRows(base, { ...base, title: "Renamed" }, { ...base });
    assert.equal(result.merged.title, "Renamed");
    assert.deepEqual(result.conflicts, []);
  });

  it("takes the server's field when only the server changed it", () => {
    const result = mergeRows(base, { ...base }, { ...base, read: true });
    assert.equal(result.merged.read, true);
    assert.deepEqual(result.conflicts, []);
  });

  it("does not call two edits to different fields a conflict", () => {
    const result = mergeRows(base, { ...base, title: "Renamed" }, { ...base, read: true });
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.merged.title, "Renamed");
    assert.equal(result.merged.read, true);
  });

  it("agreement is not a conflict", () => {
    const result = mergeRows(base, { ...base, title: "Same" }, { ...base, title: "Same" });
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.merged.title, "Same");
  });

  it("reports a field both sides moved differently, with all three values", () => {
    const result = mergeRows(base, { ...base, title: "Mine" }, { ...base, title: "Theirs" });
    assert.deepEqual(result.conflicts, [
      { field: "title", base: "Draft", local: "Mine", remote: "Theirs" },
    ]);
    // The server's value stands until the reader decides, so the device stays
    // consistent with what everyone else can see.
    assert.equal(result.merged.title, "Theirs");
  });

  it("compares structures by value, so an untouched list is untouched", () => {
    const result = mergeRows(base, { ...base, tags: ["a"] }, { ...base, tags: ["a", "b"] });
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.merged.tags, ["a", "b"]);
  });

  it("leaves the sync machinery's own columns to the server", () => {
    const result = mergeRows(base, { ...base, row_version: 9 }, { ...base, row_version: 4 });
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.merged.row_version, 4);
  });

  it("keeps the later edit stamp instead of asking", () => {
    const result = mergeRows(
      { ...base, updated_at: "2026-01-01T00:00:00Z" },
      { ...base, title: "Mine", updated_at: "2026-01-03T00:00:00Z" },
      { ...base, done: true, updated_at: "2026-01-02T00:00:00Z" },
    );
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.merged.updated_at, "2026-01-03T00:00:00Z");
  });

  it("reads one instant in two offsets as the same value", () => {
    const result = mergeRows(
      {},
      { started_at: "2026-08-27T19:24:39.357+05:00" },
      { started_at: "2026-08-27T14:24:39.357+00:00" },
    );
    assert.deepEqual(result.conflicts, []);
  });

  it("ignores key order inside structures", () => {
    const result = mergeRows({}, { config: { lr: 1, batch: 2 } }, { config: { batch: 2, lr: 1 } });
    assert.deepEqual(result.conflicts, []);
  });
});
