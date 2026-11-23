import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 0.9.8 has no sync marker: the server backend must not know the offline-sync layer. */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("the postgrest backend has no share-mark wrapper or offline-sync import", () => {
  const src = read("../wire-postgrest-backend.ts");
  assert.doesNotMatch(src, /offline-sync/);
  assert.doesNotMatch(src, /shareMarks|withShareMarks|ShareMarks/);
});

test("the share-mark wrapper and the local-first wiring are deleted", () => {
  assert.equal(existsSync(fileURLToPath(new URL("../../../../features/sharing/domain/share-marks.ts", import.meta.url))), false);
  assert.equal(existsSync(fileURLToPath(new URL("../../local", import.meta.url))), false);
});
