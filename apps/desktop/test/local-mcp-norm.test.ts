/** Project and entry matching share one name normalizer (xhelp-30). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { norm, pickProject } from "../src/local-mcp-projects";

test("norm trims, lowercases and folds whitespace runs", () => {
  assert.equal(norm("  My   Thesis\tDraft \n"), "my thesis draft");
  assert.equal(norm(""), "");
  assert.equal(norm("   "), "");
  assert.equal(norm("Ünïcode  NAME"), "ünïcode name");
});

test("pickProject matches names the way norm reads them", () => {
  const projects = [{ name: "My  Thesis", dir: "projects/my-thesis" }];
  assert.equal(pickProject(projects, "  my thesis ").name, "My  Thesis");
});
