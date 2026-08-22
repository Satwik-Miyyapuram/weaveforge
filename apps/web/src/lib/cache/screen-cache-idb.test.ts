import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __test } from "./screen-cache-idb";
import { screenCacheFetchedAt, setScreenCache } from "./screen-cache";

const { unwrap, ENVELOPE_VERSION, MAX_AGE_MS } = __test;
const NOW = 1_700_000_000_000;

function envelope(over: Record<string, unknown> = {}) {
  return { version: ENVELOPE_VERSION, fetchedAt: NOW - 1000, value: { rows: 3 }, ...over };
}

describe("persisted screen cache staleness", () => {
  it("returns the payload with the time it was fetched", () => {
    assert.deepEqual(unwrap<{ rows: number }>(envelope(), NOW), {
      value: { rows: 3 },
      fetchedAt: NOW - 1000,
    });
  });

  it("misses on an entry written by an older shape", () => {
    assert.equal(unwrap(envelope({ version: ENVELOPE_VERSION - 1 }), NOW), undefined);
    assert.equal(unwrap({ rows: 3 }, NOW), undefined);
    assert.equal(unwrap(undefined, NOW), undefined);
  });

  it("misses past the maximum age", () => {
    assert.notEqual(unwrap(envelope({ fetchedAt: NOW - MAX_AGE_MS + 1 }), NOW), undefined);
    assert.equal(unwrap(envelope({ fetchedAt: NOW - MAX_AGE_MS - 1 }), NOW), undefined);
  });

  it("misses on a timestamp from the future, whose age is unknown", () => {
    assert.equal(unwrap(envelope({ fetchedAt: NOW + 1000 }), NOW), undefined);
  });

  it("keeps the fetch time when a restored payload enters the memory cache", () => {
    setScreenCache("p:screen", { rows: 3 }, NOW - 5000);
    assert.equal(screenCacheFetchedAt("p:screen"), NOW - 5000);
  });
});
