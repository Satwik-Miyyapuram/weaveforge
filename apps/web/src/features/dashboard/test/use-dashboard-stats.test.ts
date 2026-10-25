/**
 * The dashboard stats hook loads once per project and card set.
 *
 * A production build inlined the default `getPorts` into the parameter list, so
 * every render passed a new function. `loadStats` depended on it, the effect
 * re-ran, each load set state, and the idle dashboard reloaded its stats every
 * few milliseconds (seconds of script per second, hundreds of MB held).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import type { DashboardCardType, Member, Project } from "@weaveforge/core";

import { ProjectContext } from "@/features/projects";
import { renderHook } from "@/lib/test/react-harness";
import { useDashboardStats } from "../ui/use-dashboard-stats";
import type { DashboardStatsPorts } from "../application/load-dashboard-stats";

function withProject(id: string) {
  return (children: ReactNode) => {
    const project = { id, name: "Project" } as unknown as Project;
    return createElement(
      ProjectContext.Provider,
      {
        value: {
          projects: [project],
          current: project,
          loading: false,
          setProject: () => {},
          refresh: async () => [project],
        },
      },
      children,
    );
  };
}

/** Empty ports that count how often a load asked for them. */
function countingPorts() {
  const counter = { loads: 0 };
  const ports: DashboardStatsPorts = {
    listPapers: async () => [],
    listSections: async () => [],
    listMilestones: async () => [],
    listExperiments: async () => [],
    listLogEntries: async () => [],
    listRelations: async () => [],
    getReadingListTree: async () => [],
    listTags: async () => [],
    fetchSuperviseeData: async () => ({
      milestonesByMember: new Map(),
      logsByMember: new Map(),
      error: null,
    }),
  };
  // Past a bound, stop answering so a runaway loop fails the test instead of hanging it.
  const never: DashboardStatsPorts = { ...ports, listPapers: () => new Promise(() => {}) };
  return {
    counter,
    get: () => {
      counter.loads += 1;
      return counter.loads > 50 ? never : ports;
    },
  };
}

const CARDS: readonly DashboardCardType[] = ["reading-progress"];
const NOBODY: readonly Member[] = [];

test("dashboard stats: a fresh getPorts on every render does not reload the stats", async () => {
  const { counter, get } = countingPorts();
  const harness = await renderHook(
    // A new function each render, as the minified build passes the default.
    () => useDashboardStats(CARDS, NOBODY, () => get()),
    undefined,
    { wrapper: withProject("loop-a") },
  );
  for (let i = 0; i < 5; i += 1) await harness.flush();
  assert.equal(counter.loads, 1, `stats loaded ${counter.loads} times while idle`);
  assert.equal(harness.current.statsLoading, false);
  await harness.unmount();
});

test("dashboard stats: a new card set still loads again", async () => {
  const { counter, get } = countingPorts();
  const harness = await renderHook(
    (cards: readonly DashboardCardType[]) => useDashboardStats(cards, NOBODY, () => get()),
    CARDS,
    { wrapper: withProject("loop-b") },
  );
  await harness.flush();
  const more: readonly DashboardCardType[] = ["reading-progress", "plan-progress"];
  await harness.rerender(more);
  for (let i = 0; i < 5; i += 1) await harness.flush();
  assert.equal(counter.loads, 2);
  await harness.unmount();
});
