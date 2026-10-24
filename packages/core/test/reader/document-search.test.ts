import { test } from "node:test";
import assert from "node:assert/strict";
import { findDocumentMatches, nextMatchIndex } from "../../src/reader/document-search.js";

test("findDocumentMatches is case-insensitive and ordered", () => {
  const matches = findDocumentMatches(
    [
      { pageIndex: 0, text: "Alpha beta ALPHA" },
      { pageIndex: 1, text: "gamma alpha" },
    ],
    "alpha",
  );
  assert.deepEqual(matches, [
    { pageIndex: 0, start: 0, end: 5 },
    { pageIndex: 0, start: 11, end: 16 },
    { pageIndex: 1, start: 6, end: 11 },
  ]);
});

test("findDocumentMatches skips blank queries", () => {
  assert.deepEqual(findDocumentMatches([{ pageIndex: 0, text: "x" }], "  "), []);
});

test("nextMatchIndex wraps", () => {
  assert.equal(nextMatchIndex(0, 3, 1), 1);
  assert.equal(nextMatchIndex(2, 3, 1), 0);
  assert.equal(nextMatchIndex(0, 3, -1), 2);
  assert.equal(nextMatchIndex(-1, 3, 1), 0);
  assert.equal(nextMatchIndex(0, 0, 1), -1);
});

test("match offsets stay on the original text when lowercasing changes length (07-02)", () => {
  const dotI = String.fromCodePoint(0x130); // "İ" lowercases to two code units
  const text = `${dotI}stanbul Straße meets the target`;
  const [hit] = findDocumentMatches([{ pageIndex: 0, text }], "target");
  assert.ok(hit);
  assert.equal(text.slice(hit.start, hit.end), "target");
  const [city] = findDocumentMatches([{ pageIndex: 0, text }], "stanbul");
  assert.equal(text.slice(city!.start, city!.end), "stanbul");
  const [street] = findDocumentMatches([{ pageIndex: 0, text }], "STRASSE".slice(0, 4));
  assert.equal(text.slice(street!.start, street!.end), "Stra");
  const [whole] = findDocumentMatches([{ pageIndex: 0, text }], `${dotI}stanbul`);
  assert.equal(text.slice(whole!.start, whole!.end), `${dotI}stanbul`);
});

test("a match that ends inside a lowercased letter covers that whole letter (07-02)", () => {
  const dotI = String.fromCodePoint(0x130);
  const text = `x${dotI}y`;
  const [hit] = findDocumentMatches([{ pageIndex: 0, text }], "xi");
  assert.ok(hit);
  assert.equal(text.slice(hit.start, hit.end), `x${dotI}`);
});
