import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampTtlSeconds,
  MAX_SIGNED_URL_PATHS,
  MAX_TTL_SECONDS,
  MIN_TTL_SECONDS,
} from "@/storage/signed-url-limits";

test("an absent or unusable ttl falls back to the maximum, not to forever", () => {
  assert.equal(clampTtlSeconds(undefined), MAX_TTL_SECONDS);
  assert.equal(clampTtlSeconds(null), MAX_TTL_SECONDS);
  assert.equal(clampTtlSeconds("3600"), MAX_TTL_SECONDS);
  assert.equal(clampTtlSeconds(Number.NaN), MAX_TTL_SECONDS);
  assert.equal(clampTtlSeconds(Number.POSITIVE_INFINITY), MAX_TTL_SECONDS);
});

test("a ttl past the ceiling comes back at the ceiling", () => {
  assert.equal(clampTtlSeconds(MAX_TTL_SECONDS * 1000), MAX_TTL_SECONDS);
  assert.equal(clampTtlSeconds(31_536_000), MAX_TTL_SECONDS);
});

test("a ttl below the floor comes back at the floor, negatives included", () => {
  assert.equal(clampTtlSeconds(0), MIN_TTL_SECONDS);
  assert.equal(clampTtlSeconds(-1), MIN_TTL_SECONDS);
  assert.equal(clampTtlSeconds(MIN_TTL_SECONDS - 1), MIN_TTL_SECONDS);
});

test("a ttl inside the range is kept, floored to whole seconds", () => {
  assert.equal(clampTtlSeconds(600), 600);
  assert.equal(clampTtlSeconds(600.9), 600);
  assert.equal(clampTtlSeconds(MIN_TTL_SECONDS), MIN_TTL_SECONDS);
  assert.equal(clampTtlSeconds(MAX_TTL_SECONDS), MAX_TTL_SECONDS);
});

test("the batch cap is a real bound, not a placeholder", () => {
  assert.ok(Number.isInteger(MAX_SIGNED_URL_PATHS));
  assert.ok(MAX_SIGNED_URL_PATHS > 0 && MAX_SIGNED_URL_PATHS <= 1000);
});
