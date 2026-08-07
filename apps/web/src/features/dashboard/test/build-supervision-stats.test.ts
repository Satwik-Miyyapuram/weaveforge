import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeSupervisee,
  teamAttentionItems,
  buildSupervisionStats,
} from "../application/build-supervision-stats";
import type { Member, Milestone, LogEntry } from "@weaveforge/core";

const member = (id: string): Member =>
  ({ id, email: `${id}@test.com`, role: "masters", createdAt: "" }) as Member;

describe("build-supervision-stats", () => {
  it("summarizeSupervisee flags blocked", () => {
    const s = summarizeSupervisee(
      member("a"),
      [{ id: "m", title: "GPU", status: "blocked", dependencies: [], compute: [], createdAt: "" } as Milestone],
      [],
    );
    assert.equal(s.statusLabel, "blocked");
  });

  it("teamAttentionItems lists blocked milestones", () => {
    const m = member("a");
    const ms = [{ id: "m", title: "GPU", status: "blocked", dependencies: [], compute: [], createdAt: "" } as Milestone];
    const summaries = [summarizeSupervisee(m, ms, [])];
    const map = new Map([["a", ms]]);
    const items = teamAttentionItems(summaries, map);
    assert.equal(items.length, 1);
    assert.ok(items[0]!.href.includes("member=a"));
  });

  it("buildSupervisionStats", () => {
    const m = member("a");
    const stats = buildSupervisionStats(
      [m],
      new Map([["a", []]]),
      new Map([["a", [{ id: "l", entryDate: "2026-07-01", kind: "daily", body: "x", links: [], createdAt: "" } as LogEntry]]]),
    );
    assert.equal(stats.roster.length, 1);
    assert.equal(stats.roster[0]?.lastLogDate, "2026-07-01");
  });
});
