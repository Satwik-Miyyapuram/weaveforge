import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 0.9.8 has no local database. The no-account vector store must not reach
// LocalRunner (whose query throws LOCAL_DB_REMOVED) on any path.
const source = readFileSync(new URL("../infrastructure/vector-store.ts", import.meta.url), "utf8");

test("vector store never imports LocalRunner (0.9.8: no local database)", () => {
  assert.equal(/LocalRunner/.test(source), false);
});

test("vector store has no localStore() that runs a local query", () => {
  assert.equal(/function localStore\b/.test(source), false);
  assert.equal(/runner\.query/.test(source), false);
});

test("no-account branch is a no-op store, not a local one", () => {
  assert.match(source, /const own = isLocalMode\(\) \? noStore : idbStore;/);
  assert.match(source, /const noStore: VectorStore = \{/);
});
