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
});
