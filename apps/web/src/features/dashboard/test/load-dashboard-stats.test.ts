import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dataSourcesForCardTypes } from "../application/card-registry";
import { loadDashboardStats } from "../application/load-dashboard-stats";
import { buildDashboardStats } from "../application/build-dashboard-stats";
import type { DashboardStatsPorts } from "../application/load-dashboard-stats";
import type { Member } from "@weaveforge/core";

describe("dataSourcesForCardTypes", () => {
  it("collects deps from visible cards only", () => {
    const deps = dataSourcesForCardTypes(["reading-progress", "recent-log"]);
    assert.ok(deps.has("papers"));
    assert.ok(deps.has("log"));
    assert.equal(deps.has("tags"), false);
  });
});

describe("loadDashboardStats", () => {
  it("skips fetches not required by visible cards", async () => {
    let papersCalled = false;
    let tagsCalled = false;
    const ports: DashboardStatsPorts = {
      listPapers: async () => {
        papersCalled = true;
        return [];
      },
      listSections: async () => [],
      listMilestones: async () => [],
      listExperiments: async () => [],
      listLogEntries: async () => [],
      listRelations: async () => [],
      getReadingListTree: async () => [],
      listTags: async () => {
        tagsCalled = true;
        return [];
      },
      fetchSuperviseeData: async () => ({
        milestonesByMember: new Map(),
        logsByMember: new Map(),
        error: null,
      }),
    };

    const result = await loadDashboardStats(ports, {
      cardTypes: ["reading-progress"],
      supervisees: [],
    });

    assert.ok(papersCalled);
    assert.equal(tagsCalled, false);
    assert.deepEqual(result.stats, buildDashboardStats({
      papers: [],
      sections: [],
      milestones: [],
      experiments: [],
      logEntries: [],
      relations: [],
      listCount: 0,
      tags: [],
    }));
  });
});

/** Ports that answer empty for everything; override what a test is about. */
function emptyPorts(over: Partial<DashboardStatsPorts> = {}): DashboardStatsPorts {
  return {
    listPapers: async () => [],
    listSections: async () => [],
    listMilestones: async () => [],
    listExperiments: async () => [],
    listLogEntries: async () => [],
    listRelations: async () => [],
    getReadingListTree: async () => [],
    listTags: async () => [],
    fetchSuperviseeData: async () => ({ milestonesByMember: new Map(), logsByMember: new Map(), error: null }),
    ...over,
  };
}

const SUPERVISEE = { id: "m1", name: "Ada", email: "ada@example.org" } as unknown as Member;

describe("loadDashboardStats failures and order (B70)", () => {
  it("a failed tag load is a critical error, not an empty tag card (35-08)", async () => {
    const boom = new Error("tags down");
    const result = await loadDashboardStats(emptyPorts({ listTags: async () => { throw boom; } }), {
      cardTypes: ["top-tags"],
      supervisees: [],
    });
    assert.equal(result.criticalError, boom);
  });

  it("a failed supervisee fetch gives no supervision stats, not zeros (35-09)", async () => {
    const boom = new Error("supervision down");
    const result = await loadDashboardStats(
      emptyPorts({
        fetchSuperviseeData: async () => ({ milestonesByMember: new Map(), logsByMember: new Map(), error: boom }),
      }),
      { cardTypes: [], supervisees: [SUPERVISEE] },
    );
    assert.equal(result.supervision, null);
    assert.equal(result.supervisionError, boom);
    assert.equal(result.criticalError, null);
  });

  it("a rejected supervisee fetch is reported as the supervision error (35-09)", async () => {
    const boom = new Error("thrown");
    const result = await loadDashboardStats(
      emptyPorts({ fetchSuperviseeData: () => Promise.reject(boom) }),
      { cardTypes: [], supervisees: [SUPERVISEE] },
    );
    assert.equal(result.supervision, null);
    assert.equal(result.supervisionError, boom);
  });

  it("a good supervisee fetch still builds supervision stats", async () => {
    const result = await loadDashboardStats(emptyPorts(), { cardTypes: [], supervisees: [SUPERVISEE] });
    assert.ok(result.supervision);
    assert.equal(result.supervisionError, null);
  });

  it("the supervisee fetch starts with the others, not after them (35-14)", async () => {
    let releasePapers!: () => void;
    let supervisionStarted = false;
    const pending = loadDashboardStats(
      emptyPorts({
        listPapers: () => new Promise((resolve) => { releasePapers = () => resolve([]); }),
        fetchSuperviseeData: async () => {
          supervisionStarted = true;
          return { milestonesByMember: new Map(), logsByMember: new Map(), error: null };
        },
      }),
      { cardTypes: [], supervisees: [SUPERVISEE] },
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(supervisionStarted, true, "supervision waited for the paper list");
    releasePapers();
    await pending;
  });

  it("no supervisees means no supervisee fetch", async () => {
    let called = false;
    const result = await loadDashboardStats(
      emptyPorts({ fetchSuperviseeData: async () => { called = true; return { milestonesByMember: new Map(), logsByMember: new Map(), error: null }; } }),
      { cardTypes: [], supervisees: [] },
    );
    assert.equal(called, false);
    assert.equal(result.supervision, null);
  });
});
