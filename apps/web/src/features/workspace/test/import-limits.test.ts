import assert from "node:assert/strict";
import test, { before } from "node:test";
import {
  archiveBudget,
  IMPORT_LIMITS,
  ImportLimitError,
  unzipWithinLimits,
} from "../application/parts-2";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

// 29-02: the archive's own directory is checked before anything is inflated.
test("archiveBudget rejects an archive over the entry count before inflating", () => {
  const budget = archiveBudget({ ...IMPORT_LIMITS, maxEntries: 2 });
  assert.equal(budget.filter({ name: "a.md", originalSize: 1 }), true);
  assert.equal(budget.filter({ name: "b.md", originalSize: 1 }), true);
  assert.throws(() => budget.filter({ name: "c.md", originalSize: 1 }), ImportLimitError);
});

test("archiveBudget skips an entry whose declared size is over the file cap", () => {
  const budget = archiveBudget({ ...IMPORT_LIMITS, maxFileBytes: 10 });
  assert.equal(budget.filter({ name: "big.bin", originalSize: 11 }), false);
  assert.equal(budget.filter({ name: "ok.md", originalSize: 10 }), true);
  assert.deepEqual(budget.oversize, ["big.bin"]);
});

test("archiveBudget rejects an archive whose declared total is over the cap", () => {
  const budget = archiveBudget({ ...IMPORT_LIMITS, maxFileBytes: 10, maxTotalBytes: 15 });
  assert.equal(budget.filter({ name: "a", originalSize: 10 }), true);
  assert.throws(() => budget.filter({ name: "b", originalSize: 6 }), ImportLimitError);
});

test("unzipWithinLimits never inflates a skipped entry", async () => {
  const { zipSync } = await import("fflate");
  const zip = zipSync({ "a.md": new TextEncoder().encode("hi"), "big.bin": new Uint8Array(64) });
  const { entries, oversize } = await unzipWithinLimits(zip, { ...IMPORT_LIMITS, maxFileBytes: 32 });
  assert.deepEqual(Object.keys(entries), ["a.md"]);
  assert.deepEqual(oversize, ["big.bin"]);
});
