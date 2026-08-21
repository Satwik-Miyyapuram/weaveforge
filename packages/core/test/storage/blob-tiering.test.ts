import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeBlobEvictionScore,
  rankForEviction,
  type BlobObjectRecord,
} from "../../src/storage/blob-tiering.js";

const now = new Date("2026-07-11T12:00:00Z");

function rec(partial: Partial<BlobObjectRecord> & Pick<BlobObjectRecord, "bucket" | "path">): BlobObjectRecord {
  return {
    tier: "hot",
    sizeBytes: 1000,
    accessCount: 0,
    lastAccessedAt: null,
    priority: 50,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...partial,
  };
}

describe("computeBlobEvictionScore", () => {
  it("ranks idle low-priority objects highest", () => {
    const oldDone = rec({
      bucket: "experiment-artifacts",
      path: "u/e/plot.png",
      accessCount: 2,
      priority: 20,
      lastAccessedAt: new Date("2026-04-01T00:00:00Z"),
    });
    const active = rec({
      bucket: "experiment-artifacts",
      path: "u/e/live.png",
      accessCount: 40,
      priority: 70,
      lastAccessedAt: new Date("2026-07-10T00:00:00Z"),
    });
    assert.ok(computeBlobEvictionScore(oldDone, now) > computeBlobEvictionScore(active, now));
  });

  it("rankForEviction orders descending by score", () => {
    const a = rec({ bucket: "b", path: "a", priority: 20, lastAccessedAt: new Date("2026-01-01") });
    const b = rec({ bucket: "b", path: "b", priority: 80, lastAccessedAt: new Date("2026-07-10") });
    const ranked = rankForEviction([b, a], now);
    assert.equal(ranked[0]?.path, "a");
  });
});
