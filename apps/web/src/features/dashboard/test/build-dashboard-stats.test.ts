import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  readingProgress,
  needsAttention,
  librarySnapshot,
  buildDashboardStats,
} from "../application/build-dashboard-stats";
import type { Paper, ReportSection, Milestone, Experiment, LogEntry, TagWithPaperCount } from "@thesis/core";

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

describe("build-dashboard-stats", () => {
  it("readingProgress", () => {
    const p = readingProgress([paper("a", "read"), paper("b", "to_read")]);
    assert.equal(p.done, 1);
    assert.equal(p.total, 2);
    assert.equal(p.pct, 50);
  });

  it("needsAttention lists unread, overdue, and upcoming", () => {
    const items = needsAttention(
      [paper("a", "to_read")],
      [
        { id: "m1", title: "Due", status: "planned", targetDate: "2026-07-15", dependencies: [], compute: [], createdAt: "" } as Milestone,
        { id: "m2", title: "Late", status: "planned", targetDate: "2026-07-01", dependencies: [], compute: [], createdAt: "" } as Milestone,
      ],
      [{ id: "e1", name: "x", status: "running", createdAt: "" } as Experiment],
      "2026-07-11",
    );
    assert.ok(items.some((i) => i.label.includes("unread")));
    assert.ok(items.some((i) => i.label.includes("Due")));
    assert.ok(items.some((i) => i.label.includes("overdue")));
    assert.ok(items.some((i) => i.label.includes("running")));
  });

  it("librarySnapshot", () => {
    const s = librarySnapshot(12, 18, 3);
    assert.equal(s.papers, 12);
    assert.equal(s.edges, 18);
    assert.equal(s.lists, 3);
  });

  it("buildDashboardStats integrates", () => {
    const tag: TagWithPaperCount = {
      id: "t1",
      name: "nlp",
      paperCount: 5,
    };
    const stats = buildDashboardStats({
      papers: [],
      sections: [{ id: "s", title: "t", status: "done", sortOrder: 0, createdAt: "" } as ReportSection],
      milestones: [],
      experiments: [],
      logEntries: [{ id: "l", entryDate: "2026-07-10", kind: "daily", body: "hello", links: [], createdAt: "" } as LogEntry],
      relations: [],
      listCount: 2,
      tags: [tag],
    });
    assert.equal(stats.report.done, 1);
    assert.equal(stats.recentLog.length, 1);
    assert.equal(stats.library.lists, 2);
    assert.equal(stats.topTags[0]?.name, "nlp");
  });
});
