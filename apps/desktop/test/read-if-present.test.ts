import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readIfPresent } from "../src/read-if-present";

const dir = mkdtempSync(path.join(tmpdir(), "read-if-present-"));

test("a missing file is nothing", async () => {
  assert.equal(await readIfPresent(path.join(dir, "missing.json")), null);
});

test("a present file is its contents", async () => {
  const file = path.join(dir, "here.json");
  writeFileSync(file, "{}");
  assert.equal(await readIfPresent(file), "{}");
});

test("a file that is there but cannot be read is an error, not nothing", async () => {
  // A directory where the file should be: EISDIR on every platform.
  await assert.rejects(readIfPresent(dir));
});
