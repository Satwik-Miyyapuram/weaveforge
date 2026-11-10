import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDashboardStats } from "../application/build-dashboard-stats";
import { loadTestCore } from "@/lib/test/load-test-core";
import type { Paper, PaperRelation, ReportSection, Milestone, Experiment, LogEntry, TagWithPaperCount } from "@weaveforge/core";

before(async () => {
  await loadTestCore();
});

const paper = (id: string, status: Paper["status"]): Paper =>
  ({
    id,
    title: id,
    status,
    tags: [],
    authors: [],
    metadata: {},
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  }) as Paper;

const empty = {
  papers: [] as Paper[],
  sections: [] as ReportSection[],
  milestones: [] as Milestone[],
  experiments: [] as Experiment[],
  logEntries: [] as LogEntry[],
  relations: [],
  listCount: 0,
  tags: [] as TagWithPaperCount[],
};

describe("build-dashboard-stats", () => {
  it("reading progress counts read papers over all, rounded to a percent", () => {
    const s = buildDashboardStats({ ...empty, papers: [paper("a", "read"), paper("b", "to_read")] }, "2026-07-11");
    assert.deepEqual(s.reading, { done: 1, total: 2, pct: 50 });
  });

  it("reading progress of nothing is 0 of 0 at 0%, and rounds the percentage", () => {
    assert.deepEqual(buildDashboardStats(empty, "2026-07-11").reading, { done: 0, total: 0, pct: 0 });
    const third = buildDashboardStats(
      { ...empty, papers: [paper("a", "read"), paper("b", "to_read"), paper("c", "to_read")] },
      "2026-07-11",
    );
    assert.equal(third.reading.pct, 33);
  });

  it("a milestone due on the given day is due, not overdue", () => {
    const due = { id: "m", title: "T", status: "planned", targetDate: "2026-03-10", dependencies: [], compute: [], createdAt: "2026-01-01" } as Milestone;
    const items = buildDashboardStats({ ...empty, milestones: [due] }, "2026-03-10").attention;
    assert.ok(!items.some((i) => i.label.includes("overdue")));
    assert.ok(items.some((i) => i.label.includes("due")));
  });

  it("attention lists unread, overdue, due soon, and running", () => {
    const items = buildDashboardStats(
      {
        ...empty,
        papers: [paper("a", "to_read")],
        milestones: [
          { id: "m1", title: "Due", status: "planned", targetDate: "2026-07-15", dependencies: [], compute: [], createdAt: "" } as Milestone,
          { id: "m2", title: "Late", status: "planned", targetDate: "2026-07-01", dependencies: [], compute: [], createdAt: "" } as Milestone,
        ],
        experiments: [{ id: "e1", name: "x", status: "running", createdAt: "" } as Experiment],
      },
      "2026-07-11",
    ).attention;
    assert.ok(items.some((i) => i.label.includes("unread")));
    assert.ok(items.some((i) => i.label.includes("Due")));
    assert.ok(items.some((i) => i.label.includes("overdue")));
    assert.ok(items.some((i) => i.label.includes("running")));
  });

  it("library snapshot carries the paper, edge and list counts", () => {
    const s = buildDashboardStats(
      { ...empty, papers: [paper("a", "read")], relations: [{ id: "r1" }, { id: "r2" }] as PaperRelation[], listCount: 3 },
      "2026-07-11",
    );
    assert.equal(s.library.papers, 1);
    assert.equal(s.library.edges, 2);
    assert.equal(s.library.lists, 3);
    assert.equal(s.library.href, "/graph");
  });

  it("buildDashboardStats integrates", () => {
    const tag: TagWithPaperCount = {
      id: "t1",
      name: "nlp",
      paperCount: 5,
    };
    const stats = buildDashboardStats({
      ...empty,
      sections: [{ id: "s", title: "t", status: "done", sortOrder: 0, createdAt: "" } as ReportSection],
      logEntries: [{ id: "l", entryDate: "2026-07-10", kind: "daily", body: "hello", links: [], createdAt: "" } as LogEntry],
      listCount: 2,
      tags: [tag],
    });
    assert.equal(stats.report.done, 1);
    assert.equal(stats.recentLog.length, 1);
    assert.equal(stats.library.lists, 2);
    assert.equal(stats.topTags[0]?.name, "nlp");
  });
});
