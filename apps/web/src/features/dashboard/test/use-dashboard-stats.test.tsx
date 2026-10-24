import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ContextType, type ReactElement } from "react";
import { act, create } from "react-test-renderer";
import type { Member, Project, TagWithPaperCount } from "@weaveforge/core";

import { ProjectContext } from "@/features/projects";
import type { DashboardStatsPorts } from "../application/load-dashboard-stats";
import { useDashboardStats } from "../ui/use-dashboard-stats";

type ProjectState = NonNullable<ContextType<typeof ProjectContext>>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CARDS = ["top-tags"] as const;
/** Stable, like the screen's memoised list: a fresh array each render reloads. */
const NO_SUPERVISEES: Member[] = [];

function project(id: string): ProjectState {
  return {
    projects: [],
    current: { id } as Project,
    loading: false,
    setProject: () => {},
    refresh: async () => [],
  };
}

function tag(name: string): TagWithPaperCount {
  return { id: name, name, paperCount: 1 } as TagWithPaperCount;
}

/** Ports whose tag list is whatever `listTags` answers; the rest is empty. */
function ports(listTags: () => Promise<TagWithPaperCount[]>): DashboardStatsPorts {
  return {
    listPapers: async () => [],
    listSections: async () => [],
    listMilestones: async () => [],
    listExperiments: async () => [],
    listLogEntries: async () => [],
    listRelations: async () => [],
    getReadingListTree: async () => [],
    listTags,
    fetchSuperviseeData: async () => ({ milestonesByMember: new Map(), logsByMember: new Map(), error: null }),
  };
}

type Seen = ReturnType<typeof useDashboardStats>;

function Probe({ getPorts, out }: { getPorts: () => DashboardStatsPorts; out: { current: Seen | null } }) {
  out.current = useDashboardStats(CARDS, NO_SUPERVISEES, getPorts);
  return null;
}

function tree(state: ProjectState, getPorts: () => DashboardStatsPorts, out: { current: Seen | null }): ReactElement {
  return createElement(ProjectContext.Provider, { value: state }, createElement(Probe, { getPorts, out }));
}

const flush = () => act(async () => { await new Promise((r) => setImmediate(r)); });

test("a project's late answer does not overwrite the project switched to (35-10)", async () => {
  let releaseA!: () => void;
  const portsA = ports(() => new Promise((resolve) => { releaseA = () => resolve([tag("from-a")]); }));
  const portsB = ports(async () => [tag("from-b")]);
  const out: { current: Seen | null } = { current: null };

  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(tree(project("stale-a"), () => portsA, out)); });
  await act(async () => { renderer.update(tree(project("stale-b"), () => portsB, out)); });
  await flush();
  assert.deepEqual(out.current?.stats.topTags.map((t) => t.name), ["from-b"]);

  releaseA();
  await flush();
  assert.deepEqual(out.current?.stats.topTags.map((t) => t.name), ["from-b"], "project A's answer replaced B's");
  await act(async () => { renderer.unmount(); });
});

test("a load that failed is not cached for the next visit (35-10)", async () => {
  const out: { current: Seen | null } = { current: null };
  let calls = 0;
  const failing = ports(async () => { calls += 1; throw new Error("tags down"); });

  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(tree(project("err-p"), () => failing, out)); });
  await flush();
  assert.ok(out.current?.statsError, "the failure is shown");
  await act(async () => { renderer.unmount(); });

  let release!: () => void;
  const good = ports(() => {
    calls += 1;
    return new Promise((resolve) => { release = () => resolve([tag("ok")]); });
  });
  await act(async () => { renderer = create(tree(project("err-p"), () => good, out)); });
  assert.equal(out.current?.statsLoading, true, "a failed result was served from the cache");
  release();
  await flush();
  assert.equal(calls, 2);
  assert.deepEqual(out.current?.stats.topTags.map((t) => t.name), ["ok"]);
  assert.equal(out.current?.statsError, null);
  await act(async () => { renderer.unmount(); });
});

test("a good load is cached, so the next visit paints at once", async () => {
  const out: { current: Seen | null } = { current: null };
  const good = ports(async () => [tag("cached")]);

  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(tree(project("ok-p"), () => good, out)); });
  await flush();
  await act(async () => { renderer.unmount(); });

  await act(async () => { renderer = create(tree(project("ok-p"), () => good, out)); });
  assert.equal(out.current?.statsLoading, false);
  assert.deepEqual(out.current?.stats.topTags.map((t) => t.name), ["cached"]);
  await act(async () => { renderer.unmount(); });
});
