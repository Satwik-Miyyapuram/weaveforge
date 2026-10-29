import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeZoteroLibrary } from "../zotero-web-api";

describe("normalizeZoteroLibrary (10-21)", () => {
  it("turns the bare user id Zotero shows into a library path", () => {
    assert.equal(normalizeZoteroLibrary("123456"), "users/123456");
    assert.equal(normalizeZoteroLibrary("  42 \n"), "users/42");
  });

  it("keeps a user or group path as it is", () => {
    assert.equal(normalizeZoteroLibrary("users/1"), "users/1");
    assert.equal(normalizeZoteroLibrary(" groups/77 "), "groups/77");
  });

  it("refuses anything else", () => {
    for (const bad of [undefined, "", "   ", "/users/1", "users/abc", "Users/1", "users/1/items", "groups/", "12a"]) {
      assert.equal(normalizeZoteroLibrary(bad), undefined, String(bad));
    }
  });
});
