import assert from "node:assert/strict";
import { test } from "node:test";

import { registerBlob } from "../blob-registry.mjs";

test("registerBlob upserts one row keyed by bucket and path (P2-112)", async () => {
  const calls = [];
  const db = { async query(text, values) { calls.push({ text, values }); return { rows: [] }; } };
  await registerBlob(db, { bucket: "images", path: "u1/a.webp", tier: "hot", sizeBytes: 42 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /insert into blob_objects/);
  assert.match(calls[0].text, /on conflict \(bucket, path\) do update/);
  assert.deepEqual(calls[0].values, ["u1/a.webp", "images", "u1/a.webp", "hot", 42]);
});
