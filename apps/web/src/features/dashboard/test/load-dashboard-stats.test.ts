import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dataSourcesForCardTypes } from "../application/card-registry";
import { loadDashboardStats } from "../application/load-dashboard-stats";
import { buildDashboardStats } from "../application/build-dashboard-stats";
import type { DashboardStatsPorts } from "../application/load-dashboard-stats";

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
      prefetch: async () => {},
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
