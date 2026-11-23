import assert from "node:assert/strict";
import { test } from "node:test";

import { noStore } from "@/features/search/infrastructure/vector-store";

// 0.9.8: the no-account copy with no workspace folder keeps no vectors. Vectors
// are a derived cache, so a read must find nothing and writes must do nothing.
const value = { model: "m", dimensions: 2, bytes: new Uint8Array(8), revision: "r", hashes: {} };

test("no-account store: get returns null after a set", async () => {
  await noStore.set("p1", value);
  assert.equal(await noStore.get("p1"), null);
  assert.equal(await noStore.get(null), null);
});

test("no-account store: clear resolves and get stays null", async () => {
  await noStore.clear();
  assert.equal(await noStore.get("p1"), null);
});
