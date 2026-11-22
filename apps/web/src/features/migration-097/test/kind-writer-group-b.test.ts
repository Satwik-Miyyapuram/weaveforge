import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { createGroupBWriter } from "../infrastructure/kind-writer-group-b";
import { MemorySink } from "../infrastructure/memory-sink";

before(loadTestCore);

const ROOT = "";

/** Only the listed keys, so optional fields absent on both sides compare equal. */
function picked(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, row[k]]));
}

const LOG_ROW = {
  id: "0123456789abcd01",
  entryDate: "2026-11-01",
  kind: "daily",
  body: "Ran the ablation",
  links: [{ type: "experiment", id: "0123456789abcd02" }],
  createdAt: "2026-11-01T09:00:00.000Z",
};

const MILESTONE_ROW = {
  id: "0123456789abcd03",
  title: "Submit draft",
  description: "Chapters 1 to 3",
  status: "in_progress",
  targetDate: "2026-12-01",
  dependencies: [],
  compute: [],
  createdAt: "2026-11-02T09:00:00.000Z",
};

const EXPERIMENT_ROW = {
  id: "0123456789abcd04",
  name: "Ablation",
  hypothesis: "Dropout helps",
  status: "running",
  config: { lr: 0.1 },
  metrics: { val_loss: 0.2 },
  artifacts: ["https://example.org/ckpt"],
  createdAt: "2026-11-03T09:00:00.000Z",
};

const METRIC_ROW = {
  experimentId: "0123456789abcd04",
  metric: "val_loss",
  step: 1,
  value: 0.5,
  wallTime: "2026-11-03T10:00:00.000Z",
};

const SECTION_ROW = {
  id: "0123456789abcd05",
  title: "Introduction",
  sectionNo: "1",
  status: "drafting",
  wordCount: 120,
  targetWords: 800,
  deadline: "2026-12-10",
  draftUrl: "https://example.org/draft",
  notes: "Needs citations",
  sortOrder: 1,
  createdAt: "2026-11-04T09:00:00.000Z",
};

const PROPOSAL_ROW = {
  id: "0123456789abcd06",
  kind: "create_log_entry",
  resourceId: "0123456789abcd01",
  content: "Draft log entry",
  createdAt: "2026-11-05T09:00:00.000Z",
  status: "pending",
  sourceLinks: ["0123456789abcd04"],
};

test("writer owns exactly the group (b) kinds", () => {
  const writer = createGroupBWriter(new MemorySink(), ROOT);
  assert.deepEqual([...writer.kinds].sort(), [
    "aiProposals",
    "experiments",
    "logEntries",
    "metrics",
    "milestones",
    "reportSections",
  ]);
});

test("logEntries: written row reads back field-equal", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOT);
  await writer.write("logEntries", LOG_ROW);
  const [back] = await writer.readBack("logEntries");
  const keys = Object.keys(LOG_ROW);
  assert.deepEqual(picked(back!, keys), picked(LOG_ROW, keys));
});

test("milestones: written row reads back field-equal", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOT);
  await writer.write("milestones", MILESTONE_ROW);
  const [back] = await writer.readBack("milestones");
  const keys = Object.keys(MILESTONE_ROW);
  assert.deepEqual(picked(back!, keys), picked(MILESTONE_ROW, keys));
});

test("experiments: written row reads back field-equal", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOT);
  await writer.write("experiments", EXPERIMENT_ROW);
  const [back] = await writer.readBack("experiments");
  const keys = Object.keys(EXPERIMENT_ROW);
  assert.deepEqual(picked(back!, keys), picked(EXPERIMENT_ROW, keys));
});

test("metrics: written point reads back field-equal (experiment written first)", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOT);
  await writer.write("experiments", EXPERIMENT_ROW);
  await writer.write("metrics", METRIC_ROW);
  const [back] = await writer.readBack("metrics");
  const keys = Object.keys(METRIC_ROW);
  assert.deepEqual(picked(back!, keys), picked(METRIC_ROW, keys));
});

test("reportSections: written row reads back field-equal except updatedAt (stamped by save)", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOT);
  await writer.write("reportSections", SECTION_ROW);
  const [back] = await writer.readBack("reportSections");
  const keys = Object.keys(SECTION_ROW);
  assert.deepEqual(picked(back!, keys), picked(SECTION_ROW, keys));
});

test("aiProposals: pending proposal reads back field-equal", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOT);
  await writer.write("aiProposals", PROPOSAL_ROW);
  const [back] = await writer.readBack("aiProposals");
  const keys = Object.keys(PROPOSAL_ROW);
  assert.deepEqual(picked(back!, keys), picked(PROPOSAL_ROW, keys));
});

test("unknown kind is rejected on write and readBack", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOT);
  await assert.rejects(() => writer.write("notes", { id: "x" }), /unknown kind/);
  await assert.rejects(() => writer.readBack("notes"), /unknown kind/);
});

test("aiProposals: accepted and rejected proposals are read back too, not only pending", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOT);
  const accepted = { ...PROPOSAL_ROW, id: "0123456789abcd07", status: "accepted", createdAt: "2026-11-04T09:00:00.000Z" };
  const rejected = { ...PROPOSAL_ROW, id: "0123456789abcd08", status: "rejected", createdAt: "2026-11-03T09:00:00.000Z" };
  await writer.write("aiProposals", accepted);
  await writer.write("aiProposals", rejected);
  const back = await writer.readBack("aiProposals");
  assert.deepEqual(back.map((p) => p.status).sort(), ["accepted", "rejected"]);
});

test("metrics: a long series (60 points) reads back complete, same steps and values", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOT);
  await writer.write("experiments", EXPERIMENT_ROW);
  const source = Array.from({ length: 60 }, (_, i) => ({ ...METRIC_ROW, step: i, value: i / 100 }));
  for (const p of source) await writer.write("metrics", p);
  const back = await writer.readBack("metrics");
  assert.equal(back.length, 60);
  assert.deepEqual(
    back.map((p) => [p.step, p.value]).sort((a, b) => (a[0] as number) - (b[0] as number)),
    source.map((p) => [p.step, p.value]),
  );
});
