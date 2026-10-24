import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveBudget,
  IMPORT_LIMITS,
  ImportLimitError,
  sanitizeArchiveEntries,
  stripArchiveRoot,
  unzipWithinLimits,
} from "../application/import-limits";

const bytes = (n: number) => new Uint8Array(n);

test("traversal entries are skipped, not imported", () => {
  const { safe, skipped } = sanitizeArchiveEntries({
    "notes/good.md": bytes(10),
    "../../etc/passwd": bytes(10),
    "..\\..\\windows\\system32": bytes(10),
    "/absolute": bytes(10),
  });

  assert.deepEqual(safe.map((e) => e.path), ["notes/good.md"]);
  assert.equal(skipped.length, 3);
});

test("one bad entry does not cost the whole import", () => {
  const { safe } = sanitizeArchiveEntries({
    "notes/a.md": bytes(10),
    "../evil": bytes(10),
    "notes/b.md": bytes(10),
  });

  assert.equal(safe.length, 2);
});

test("an oversized single file is skipped", () => {
  const { safe, skipped } = sanitizeArchiveEntries({
    "notes/huge.md": bytes(IMPORT_LIMITS.maxFileBytes + 1),
    "notes/ok.md": bytes(5),
  });

  assert.deepEqual(safe.map((e) => e.path), ["notes/ok.md"]);
  assert.equal(skipped.length, 1);
});

test("a zip bomb is refused rather than inflated", () => {
  const entries: Record<string, Uint8Array> = {};
  // Twelve entries just under the per-file cap blow the total budget.
  for (let i = 0; i < 12; i += 1) entries[`n${i}.md`] = bytes(IMPORT_LIMITS.maxFileBytes);

  assert.throws(() => sanitizeArchiveEntries(entries), ImportLimitError);
});

test("an absurd entry count is refused before anything is read", () => {
  const entries: Record<string, Uint8Array> = {};
  for (let i = 0; i <= IMPORT_LIMITS.maxEntries; i += 1) entries[`n${i}.md`] = bytes(1);

  assert.throws(() => sanitizeArchiveEntries(entries), ImportLimitError);
});

test("directory markers and empty entries are ignored", () => {
  const { safe } = sanitizeArchiveEntries({ "notes/": bytes(0), "notes/a.md": bytes(3) });

  assert.deepEqual(safe.map((e) => e.path), ["notes/a.md"]);
});

test("the export's wrapping directory is stripped", () => {
  const stripped = stripArchiveRoot([
    { path: "weaveforge-2026-08-05/notes/a.md", bytes: bytes(1) },
    { path: "weaveforge-2026-08-05/papers/b.md", bytes: bytes(1) },
  ]);

  assert.deepEqual(stripped.map((e) => e.path), ["notes/a.md", "papers/b.md"]);
});

test("a folder with several top-level dirs is left alone", () => {
  const entries = [
    { path: "notes/a.md", bytes: bytes(1) },
    { path: "papers/b.md", bytes: bytes(1) },
  ];

  assert.deepEqual(stripArchiveRoot(entries).map((e) => e.path), ["notes/a.md", "papers/b.md"]);
});

test("an empty archive is handled without throwing", () => {
  assert.deepEqual(stripArchiveRoot([]), []);
  assert.deepEqual(sanitizeArchiveEntries({}).safe, []);
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
