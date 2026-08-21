import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";
import { MAX_POINTS_PER_REQUEST, MAX_SERIES_PER_REQUEST } from "../limits";

test("POST /api/sdk/metrics: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/sdk/metrics", { method: "POST" }))).status, 401);
});

test("the ingest limits are real bounds, not placeholders", () => {
  assert.ok(Number.isInteger(MAX_POINTS_PER_REQUEST));
  assert.ok(MAX_POINTS_PER_REQUEST > 0 && MAX_POINTS_PER_REQUEST <= 100_000);
  assert.ok(Number.isInteger(MAX_SERIES_PER_REQUEST));
  // A batch cannot hold more curves than it holds points, so a series cap
  // above the point cap would never fire.
  assert.ok(MAX_SERIES_PER_REQUEST > 0 && MAX_SERIES_PER_REQUEST <= MAX_POINTS_PER_REQUEST);
});
