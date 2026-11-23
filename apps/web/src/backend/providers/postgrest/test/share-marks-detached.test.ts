import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 0.9.8 has no sync marker: the server backend must not know the offline-sync layer. */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("the postgrest backend has no share-mark wrapper or offline-sync import", () => {
  const src = read("../wire-postgrest-backend.ts");
  assert.doesNotMatch(src, /offline-sync/);
  assert.doesNotMatch(src, /shareMarks|withShareMarks|ShareMarks/);
});

test("the local-first wiring no longer passes share marks", () => {
  const src = read("../../local/local-first.ts");
  assert.doesNotMatch(src, /shareMarks|SharedRowMarks/);
});
