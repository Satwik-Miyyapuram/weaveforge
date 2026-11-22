import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../infrastructure/postgrest-source.ts", import.meta.url)),
  "utf8",
);

test("PostgrestSource documents rpc/mark_exported_097 as its one allowed write", () => {
  assert.match(
    SOURCE,
    /The only write this source makes is rpc\/mark_exported_097/,
  );
});

test("PostgrestSource has exactly one non-read request method, the mark call", () => {
  const writes = SOURCE.match(/method: "(POST|PATCH|PUT|DELETE)"/g) ?? [];
  assert.equal(writes.length, 1);
  assert.match(SOURCE, /rpc\/mark_exported_097/);
});
