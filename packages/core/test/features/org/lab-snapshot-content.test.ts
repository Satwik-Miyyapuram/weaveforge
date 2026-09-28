import { test } from "node:test";
import assert from "node:assert/strict";

import { buildLabSnapshotContent } from "../../../src/features/org/domain/lab-snapshot.js";
import type { Experiment } from "../../../src/features/experiments/domain/experiment.js";
import type { ReportSection } from "../../../src/features/report/domain/report-section.js";

const experiment = {
  id: "e1", name: "Baseline", status: "running", config: { seed: 1 }, metrics: { loss: 0.2 },
  artifacts: [], resultNote: "Converges", createdAt: "2026-01-01", updatedAt: "2026-01-01",
} as unknown as Experiment;
const section = {
  id: "r1", title: "Methods", status: "drafting", wordCount: 1200, notes: "private", createdAt: "2026-01-01",
} as unknown as ReportSection;

test("snapshot content keeps experiments, report progress and the AI count", () => {
  const content = buildLabSnapshotContent({ milestones: [], logs: [], experiments: [experiment], report: [section], aiAssisted: 3 });
  assert.deepEqual(content.experiments, [{ id: "e1", name: "Baseline", status: "running", resultNote: "Converges" }]);
  assert.deepEqual(content.report, [{ id: "r1", title: "Methods", status: "drafting", wordCount: 1200 }]);
  assert.equal(content.aiAssisted, 3);
});

test("an unknown AI count is left out rather than shown as zero", () => {
  const content = buildLabSnapshotContent({ milestones: [], logs: [], experiments: [], report: [] });
  assert.equal("aiAssisted" in content, false);
});
