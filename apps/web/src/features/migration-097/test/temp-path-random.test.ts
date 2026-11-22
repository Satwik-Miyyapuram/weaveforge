import assert from "node:assert/strict";
import { test } from "node:test";
import { isTempPath, tempPathFor } from "@/lib/temp-path";

test("tempPathFor adds 8 random hex digits and .part to the target name", () => {
  assert.match(tempPathFor("notes/a.md"), /^notes\/a\.md\.[0-9a-f]{8}\.part$/);
});

test("two temp names for one target never collide in a run of 500", () => {
  const names = new Set(Array.from({ length: 500 }, () => tempPathFor("settings.json")));
  assert.equal(names.size, 500);
});

test("isTempPath accepts a generated name and refuses a user's plain .part file", () => {
  assert.equal(isTempPath(tempPathFor("settings.json")), true);
  assert.equal(isTempPath("settings.json.part"), false);
  assert.equal(isTempPath("settings.json.ABCDEF12.part"), false, "upper-case hex is not generated");
});
