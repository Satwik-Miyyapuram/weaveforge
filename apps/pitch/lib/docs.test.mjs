import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { GITHUB_FILES } from "./docs.ts";

// lib/ -> pitch/ -> apps/ -> repo root
const DOCS = path.resolve(import.meta.dirname, "../../../docs");

test("every file listed in GITHUB_FILES exists under docs/", () => {
  assert.ok(GITHUB_FILES.size > 0);
  for (const rel of GITHUB_FILES) {
    assert.ok(fs.existsSync(path.join(DOCS, rel)), `${rel} is listed in lib/docs.ts but missing from docs/`);
  }
});
