import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { createGroupBWriter } from "../infrastructure/kind-writer-group-b";
import { MemorySink } from "../infrastructure/memory-sink";

before(loadTestCore);

/** Project id to folder: every row must name a project that has a folder here. */
const ROOTS: ReadonlyMap<string, string> = new Map([["proj-1", ""]]);

/** Only the listed keys, so optional fields absent on both sides compare equal. */
function picked(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  // projectId is the routing key: readBack returns the file row, which never holds it.
  return Object.fromEntries(keys.filter((k) => k !== "projectId").map((k) => [k, row[k]]));
}

const LOG_ROW = {
  projectId: "proj-1",
  id: "0123456789abcd01",
  entryDate: "2026-11-01",
  kind: "daily",
  body: "Ran the ablation",
  links: [{ type: "experiment", id: "0123456789abcd02" }],
  createdAt: "2026-11-01T09:00:00.000Z",
};

const MILESTONE_ROW = {
  projectId: "proj-1",
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
  projectId: "proj-1",
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
  projectId: "proj-1",
  experimentId: "0123456789abcd04",
  metric: "val_loss",
  step: 1,
  value: 0.5,
  wallTime: "2026-11-03T10:00:00.000Z",
};

const SECTION_ROW = {
  projectId: "proj-1",
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
  projectId: "proj-1",
  id: "0123456789abcd06",
  kind: "create_log_entry",
  resourceId: "0123456789abcd01",
  content: "Draft log entry",
  createdAt: "2026-11-05T09:00:00.000Z",
  status: "pending",
  sourceLinks: ["0123456789abcd04"],
};

test("writer owns exactly the group (b) kinds", () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
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
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("logEntries", LOG_ROW);
  const [back] = await writer.readBack("logEntries");
  const keys = Object.keys(LOG_ROW);
  assert.deepEqual(picked(back!, keys), picked(LOG_ROW, keys));
});

test("milestones: written row reads back field-equal", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("milestones", MILESTONE_ROW);
  const [back] = await writer.readBack("milestones");
  const keys = Object.keys(MILESTONE_ROW);
  assert.deepEqual(picked(back!, keys), picked(MILESTONE_ROW, keys));
});

test("experiments: written row reads back field-equal", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("experiments", EXPERIMENT_ROW);
  const [back] = await writer.readBack("experiments");
  const keys = Object.keys(EXPERIMENT_ROW);
  assert.deepEqual(picked(back!, keys), picked(EXPERIMENT_ROW, keys));
});

test("experiments: every server field survives (repo, commit, branch, run, note, timing)", async () => {
  const full = {
    ...EXPERIMENT_ROW,
    repoUrl: "https://example.org/repo.git",
    commitSha: "abc1234",
    branch: "main",
    runCommand: "python train.py",
    resultNote: "Val loss down",
    startedAt: "2026-11-03T10:00:00.000Z",
    finishedAt: "2026-11-03T11:00:00.000Z",
    status: "completed",
  };
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("experiments", full);
  const [back] = await writer.readBack("experiments");
  const { projectId: _routing, ...expected } = full;
  assert.deepEqual(back, expected);
});

test("metrics: written point reads back field-equal (experiment written first)", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("experiments", EXPERIMENT_ROW);
  await writer.write("metrics", METRIC_ROW);
  const [back] = await writer.readBack("metrics");
  const keys = Object.keys(METRIC_ROW);
  assert.deepEqual(picked(back!, keys), picked(METRIC_ROW, keys));
});

test("reportSections: written row reads back field-equal except updatedAt (stamped by save)", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("reportSections", SECTION_ROW);
  const [back] = await writer.readBack("reportSections");
  const keys = Object.keys(SECTION_ROW);
  assert.deepEqual(picked(back!, keys), picked(SECTION_ROW, keys));
});

test("reportSections: a re-run with the same rows leaves every file byte-unchanged", async () => {
  const sink = new MemorySink();
  const writer = createGroupBWriter(sink, ROOTS);
  await writer.write("reportSections", SECTION_ROW);
  const before = new Map<string, string>();
  for (const p of sink.paths()) before.set(p, await sink.readText(p));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await writer.write("reportSections", SECTION_ROW);
  assert.deepEqual(sink.paths(), [...before.keys()]);
  for (const [p, text] of before) assert.equal(await sink.readText(p), text, p);
});

test("reportSections: a sparse row (optional fields null) re-runs byte-unchanged", async () => {
  const sink = new MemorySink();
  const writer = createGroupBWriter(sink, ROOTS);
  const sparse = { ...SECTION_ROW, deadline: null, draftUrl: null, notes: null, targetWords: null };
  await writer.write("reportSections", sparse);
  const before = new Map<string, string>();
  for (const p of sink.paths()) before.set(p, await sink.readText(p));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await writer.write("reportSections", sparse);
  for (const [p, text] of before) assert.equal(await sink.readText(p), text, p);
});

test("aiProposals: pending proposal reads back field-equal", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("aiProposals", PROPOSAL_ROW);
  const [back] = await writer.readBack("aiProposals");
  const keys = Object.keys(PROPOSAL_ROW);
  assert.deepEqual(picked(back!, keys), picked(PROPOSAL_ROW, keys));
});

test("unknown kind is rejected on write and readBack", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await assert.rejects(() => writer.write("notes", { id: "x" }), /unknown kind/);
  await assert.rejects(() => writer.readBack("notes"), /unknown kind/);
});

test("aiProposals: accepted and rejected proposals are read back too, not only pending", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  const accepted = { ...PROPOSAL_ROW, id: "0123456789abcd07", status: "accepted", createdAt: "2026-11-04T09:00:00.000Z" };
  const rejected = { ...PROPOSAL_ROW, id: "0123456789abcd08", status: "rejected", createdAt: "2026-11-03T09:00:00.000Z" };
  await writer.write("aiProposals", accepted);
  await writer.write("aiProposals", rejected);
  const back = await writer.readBack("aiProposals");
  assert.deepEqual(back.map((p) => p.status).sort(), ["accepted", "rejected"]);
});

test("metrics: a long series (60 points) reads back complete, same steps and values", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
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

test("metrics: an orphan point (no experiment row) is rejected and the error names it", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await assert.rejects(() => writer.write("metrics", { ...METRIC_ROW, experimentId: "0123456789abcdff" }), /0123456789abcdff.*val_loss|val_loss.*0123456789abcdff/);
});

test("metrics: a chunk already on disk with different text is a conflict, not a silent skip", async () => {
  const sink = new MemorySink();
  const writer = createGroupBWriter(sink, ROOTS);
  await writer.write("experiments", EXPERIMENT_ROW);
  await writer.write("metrics", METRIC_ROW);
  const chunk = sink.paths().find((p) => p.endsWith(".csv"))!;
  await sink.write(chunk, "run,step,metric,value\nedited,0,val_loss,9\n");
  await assert.rejects(() => writer.write("metrics", METRIC_ROW), (err: Error) => err.message.startsWith("conflict:") && err.message.includes(chunk));
});
const OWNER = { userId: "user-1", projectId: "proj-1" };

test("server-only owner columns never reach a file (guard, green today)", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("experiments", { ...EXPERIMENT_ROW, ...OWNER });
  await writer.write("logEntries", { ...LOG_ROW, ...OWNER });
  await writer.write("milestones", { ...MILESTONE_ROW, ...OWNER });
  await writer.write("reportSections", { ...SECTION_ROW, ...OWNER });
  await writer.write("aiProposals", { ...PROPOSAL_ROW, ...OWNER });
  for (const kind of ["experiments", "logEntries", "milestones", "reportSections", "aiProposals"]) {
    for (const back of await writer.readBack(kind)) {
      assert.equal("userId" in back, false, `${kind} leaked userId`);
      assert.equal("projectId" in back, false, `${kind} leaked projectId`);
    }
  }
});

test("server-only owner columns are stripped before the file write for every group (b) kind", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("experiments", { ...EXPERIMENT_ROW, ...OWNER });
  await writer.write("metrics", { ...METRIC_ROW, ...OWNER });
  const [point] = await writer.readBack("metrics");
  assert.equal("userId" in point!, false);
  assert.equal("projectId" in point!, false);
});

test("aiProposals: a non-owner column the row carries is kept (red now: writer maps fields)", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("aiProposals", { ...PROPOSAL_ROW, ...OWNER, note: "x" });
  const [back] = await writer.readBack("aiProposals");
  assert.equal(back!.note, "x");
  assert.equal("userId" in back!, false);
});

test("two projects: each row is written under its own folder and both read back", async () => {
  const sink = new MemorySink();
  const writer = createGroupBWriter(sink, new Map([["proj-1", "alpha"], ["proj-2", "beta"]]));
  await writer.write("logEntries", { ...LOG_ROW, projectId: "proj-1" });
  await writer.write("logEntries", { ...LOG_ROW, id: "0123456789abcd0a", projectId: "proj-2" });
  const files = await sink.list();
  assert.ok(files.some((p) => p.startsWith("alpha/")), "proj-1 row under alpha/");
  assert.ok(files.some((p) => p.startsWith("beta/")), "proj-2 row under beta/");
  const back = await writer.readBack("logEntries");
  assert.deepEqual(back.map((r) => r.id).sort(), [LOG_ROW.id, "0123456789abcd0a"].sort());
});

test("a row whose project has no folder is refused, and the error names the project", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await assert.rejects(() => writer.write("logEntries", { ...LOG_ROW, projectId: "proj-9" }), /no folder for project proj-9/);
});

test("updatedAt and deletedAt on a log row are server columns: not written to the file", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("logEntries", { ...LOG_ROW, updatedAt: "2026-11-02T00:00:00.000Z", deletedAt: null });
  const [back] = await writer.readBack("logEntries");
  assert.equal("updatedAt" in back!, false);
  assert.equal("deletedAt" in back!, false);
});

test("server stamps a format does not keep are never written: deletedAt on every group-b kind, updatedAt where the file has none", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  const stamp = { updatedAt: "2026-11-03T00:00:00.000Z", deletedAt: null };
  await writer.write("milestones", { ...MILESTONE_ROW, ...stamp });
  await writer.write("experiments", { ...EXPERIMENT_ROW, ...stamp });
  await writer.write("reportSections", { ...SECTION_ROW, deletedAt: null });
  await writer.write("aiProposals", { ...PROPOSAL_ROW, deletedAt: null });
  const [milestone] = await writer.readBack("milestones");
  const [experiment] = await writer.readBack("experiments");
  const [section] = await writer.readBack("reportSections");
  const [proposal] = await writer.readBack("aiProposals");
  for (const row of [milestone, experiment]) {
    assert.equal("updatedAt" in row!, false);
    assert.equal("deletedAt" in row!, false);
  }
  assert.equal("deletedAt" in section!, false);
  assert.equal("deletedAt" in proposal!, false);
});

test("syncState is local sync bookkeeping: a row carrying it is written without it", async () => {
  const writer = createGroupBWriter(new MemorySink(), ROOTS);
  await writer.write("milestones", { ...MILESTONE_ROW, syncState: "synced" });
  const [back] = await writer.readBack("milestones");
  assert.equal("syncState" in back!, false);
});

test("aiProposals are workspace-wide: with two project folders, each proposal is read back once", async () => {
  const writer = createGroupBWriter(new MemorySink(), new Map([["proj-1", ""], ["proj-2", "Other"]]));
  await writer.write("aiProposals", {
    projectId: "proj-1",
    id: "0123456789abcd06",
    kind: "create_log_entry",
    resourceId: "0123456789abcd01",
    content: "Draft log entry",
    createdAt: "2026-11-05T09:00:00.000Z",
    status: "pending",
    sourceLinks: [],
  });
  const back = await writer.readBack("aiProposals");
  assert.deepEqual(back.map((p) => p.id), ["0123456789abcd06"]);
});
