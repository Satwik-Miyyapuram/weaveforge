import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSectionTree,
  createReportSection,
  ReportSectionValidationError,
  type ReportSection,
} from "../../../src/features/report/domain/report-section.js";
import type { Clock, IdGenerator } from "../../../src/shared/clock.js";

const clock: Clock = { nowIso: () => "2026-06-24T12:00:00.000Z" };
let counter = 0;
const ids: IdGenerator = { newId: () => `id-${++counter}` };

test("createReportSection applies defaults", () => {
  counter = 0;
  const s = createReportSection({ title: "  Background  " }, { clock, ids });
  assert.equal(s.title, "Background"); // trimmed
  assert.equal(s.status, "not_started");
  assert.equal(s.wordCount, 0);
  assert.equal(s.sortOrder, 0);
  assert.equal(s.createdAt, "2026-06-24T12:00:00.000Z");
  assert.equal(s.id, "id-1");
});

test("createReportSection rejects empty title", () => {
  assert.throws(
    () => createReportSection({ title: " " }, { clock, ids }),
    ReportSectionValidationError,
  );
});

test("createReportSection rejects negative target words", () => {
  assert.throws(
    () => createReportSection({ title: "X", targetWords: -5 }, { clock, ids }),
    ReportSectionValidationError,
  );
});

test("buildSectionTree nests and orders siblings", () => {
  const base = (o: Partial<ReportSection>): ReportSection => ({
    id: "x",
    title: "t",
    status: "not_started",
    wordCount: 0,
    sortOrder: 0,
    createdAt: "2026-06-24T00:00:00.000Z",
    ...o,
  });
  const tree = buildSectionTree([
    base({ id: "c", sortOrder: 0 }),
    base({ id: "c2", parentId: "c", sortOrder: 2 }),
    base({ id: "c1", parentId: "c", sortOrder: 1 }),
  ]);
  assert.equal(tree.length, 1);
  assert.deepEqual(
    tree[0]?.children.map((n) => n.section.id),
    ["c1", "c2"],
  );
});
