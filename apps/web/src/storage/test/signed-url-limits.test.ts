import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SIGNED_URL_PATHS } from "@/storage/signed-url-limits";

test("the batch cap is a real bound, not a placeholder", () => {
  assert.ok(Number.isInteger(MAX_SIGNED_URL_PATHS));
  assert.ok(MAX_SIGNED_URL_PATHS > 0 && MAX_SIGNED_URL_PATHS <= 1000);
});
