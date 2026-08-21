import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPaper,
  normalizeDoi,
  PaperValidationError,
} from "../../../src/features/papers/domain/paper.js";
import type { Clock, IdGenerator } from "../../../src/shared/clock.js";

const clock: Clock = { nowIso: () => "2026-06-24T12:00:00.000Z" };
let counter = 0;
const ids: IdGenerator = { newId: () => `id-${++counter}` };

test("createPaper applies defaults", () => {
  counter = 0;
  const p = createPaper({ title: "  Beta-VAE  " }, { clock, ids });
  assert.equal(p.title, "Beta-VAE"); // trimmed
  assert.equal(p.status, "to_read");
  assert.deepEqual(p.authors, []);
  assert.deepEqual(p.metadata, {});
  assert.equal(p.createdAt, "2026-06-24T12:00:00.000Z");
  assert.equal(p.id, "id-1");
});

test("createPaper rejects empty title", () => {
  assert.throws(
    () => createPaper({ title: "   " }, { clock, ids }),
    PaperValidationError,
  );
});

test("createPaper rejects out-of-range rating", () => {
  assert.throws(
    () => createPaper({ title: "X", rating: 7 }, { clock, ids }),
    PaperValidationError,
  );
});

test("normalizeDoi strips url prefix and lowercases", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1145/ABC"), "10.1145/abc");
  assert.equal(normalizeDoi("10.1145/abc"), "10.1145/abc");
  assert.equal(normalizeDoi(undefined), undefined);
});
