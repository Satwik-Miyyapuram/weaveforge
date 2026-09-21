/**
 * `ExperimentsFacade`: what loading the experiments screen is allowed to do.
 *
 * Opening this screen used to write. `loadScreenData` delegated to a
 * reconciliation that marked quiet runs abandoned, so every mount, project
 * switch and poll issued status updates, React's development double-invoke
 * issued them twice, and — because the screen merges in other people's pinned
 * and shared runs — the filter on `status` alone let it rewrite a colleague's
 * run. None of that is visible from the screen; it is only visible from here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  Experiment,
  IExperimentActivityReader,
  IMetricHistoryReader,
  MetricBudget,
} from "@weaveforge/core";
import { ExperimentsFacade } from "../facades/experiments";
import type { ExperimentsScreenData } from "@/features/experiments/application/load-experiments-screen.use-case";

const NOW = Date.now();
/** Comfortably past `STALE_RUNNING_MS`, so "quiet" is not a close call. */
const LONG_AGO = new Date(NOW - 60 * 60 * 1000).toISOString();

function experiment(input: Partial<Experiment> & { id: string }): Experiment {
  return {
    name: input.id,
    status: "running",
    startedAt: LONG_AGO,
    artifacts: [],
    config: {},
    metrics: {},
    ...input,
  } as Experiment;
}

interface Harness {
  facade: ExperimentsFacade;
  statusWrites: { id: string; status: string }[];
  loads: () => number;
}

/** A facade over fakes, with the writes it makes recorded rather than sent. */
function harness(data: ExperimentsScreenData, options: { lastActivity?: Map<string, number> } = {}): Harness {
  const statusWrites: { id: string; status: string }[] = [];
  let loads = 0;
  const facade = new ExperimentsFacade({
    load: {
      execute: async () => {
        loads += 1;
        return data;
      },
    } as never,
    experiments: {} as never,
    papers: {} as never,
    // Typed as the two ports the facade depends on, with no `as never` escape:
    // the facade draws curves and asks when a run last logged, and it does not
    // write one. If this dependency were widened back to include the writer,
    // this object would stop compiling — which is the whole point of the split.
    metrics: {
      latestActivityAt: async () => options.lastActivity ?? new Map<string, number>(),
      history: async (_experimentId: string, _metric: string | undefined, _budget: MetricBudget) => [],
    } satisfies IMetricHistoryReader & IExperimentActivityReader,
    manageExperiment: {
      setStatus: async (id: string, status: string) => {
        // A real write takes a round trip; yielding lets a second caller
        // interleave if the facade does not single-flight.
        await new Promise((resolve) => setTimeout(resolve, 0));
        statusWrites.push({ id, status });
        return experiment({ id, status: "abandoned" });
      },
    } as never,
    artifacts: {
      upload: async () => "memory://x",
      viewUrls: async () => [],
    } as never,
  });
  return { facade, statusWrites, loads: () => loads };
}

test("experiments facade: loading the screen writes nothing", async () => {
  const data: ExperimentsScreenData = {
    experiments: [experiment({ id: "e1" })],
    pinnedSharedBy: new Map(),
    experimentCanComment: new Map(),
  };
  const { facade, statusWrites } = harness(data);

  await facade.loadScreenData();

  assert.deepEqual(statusWrites, [], "a read path must not mutate");
});

test("experiments facade: reconciliation abandons a quiet run of our own", async () => {
  const data: ExperimentsScreenData = {
    experiments: [experiment({ id: "e1" })],
    pinnedSharedBy: new Map(),
    experimentCanComment: new Map(),
  };
  const { facade, statusWrites } = harness(data);

  await facade.reconcileStaleRuns();

  assert.deepEqual(statusWrites, [{ id: "e1", status: "abandoned" }]);
});

test("experiments facade: a run somebody else shared is never rewritten", async () => {
  // The screen merges pinned/shared experiments into the same list, and the
  // read-only guard for those lives in the UI. Reconciliation has to apply the
  // rule itself, or opening your own screen edits a colleague's run.
  const data: ExperimentsScreenData = {
    experiments: [experiment({ id: "mine" }), experiment({ id: "theirs" })],
    pinnedSharedBy: new Map([["theirs", "alice"]]),
    experimentCanComment: new Map(),
  };
  const { facade, statusWrites } = harness(data);

  await facade.reconcileStaleRuns();

  assert.deepEqual(statusWrites, [{ id: "mine", status: "abandoned" }]);
});

test("experiments facade: a run that logged recently is left alone", async () => {
  const data: ExperimentsScreenData = {
    experiments: [experiment({ id: "e1" })],
    pinnedSharedBy: new Map(),
    experimentCanComment: new Map(),
  };
  const { facade, statusWrites } = harness(data, {
    lastActivity: new Map([["e1", Date.now()]]),
  });

  await facade.reconcileStaleRuns();

  assert.deepEqual(statusWrites, []);
});

test("experiments facade: two concurrent reconciliations make one batch of writes", async () => {
  const data: ExperimentsScreenData = {
    experiments: [experiment({ id: "e1" }), experiment({ id: "e2" })],
    pinnedSharedBy: new Map(),
    experimentCanComment: new Map(),
  };
  const { facade, statusWrites, loads } = harness(data);

  await Promise.all([facade.reconcileStaleRuns(), facade.reconcileStaleRuns()]);

  assert.equal(loads(), 1, "the second caller joined the first pass");
  assert.deepEqual(
    statusWrites.map((write) => write.id),
    ["e1", "e2"],
    "each run is written once, not once per caller",
  );
});

test("experiments facade: a finished reconciliation can be run again", async () => {
  // Single-flight, not a one-shot: the second pass must not be swallowed by a
  // stale promise left over from the first.
  const data: ExperimentsScreenData = {
    experiments: [experiment({ id: "e1" })],
    pinnedSharedBy: new Map(),
    experimentCanComment: new Map(),
  };
  const { facade, statusWrites } = harness(data);

  await facade.reconcileStaleRuns();
  await facade.reconcileStaleRuns();

  assert.deepEqual(
    statusWrites.map((write) => write.id),
    ["e1", "e1"],
  );
});

test("experiments facade: bulk uploads are bounded, and recorded as one change", async () => {
  let inFlight = 0;
  let peak = 0;
  const entries: string[] = [];
  let rowWrites = 0;
  const facade = new ExperimentsFacade({
    load: {} as never,
    experiments: {} as never,
    papers: {} as never,
    metrics: {} as never,
    manageExperiment: {
      addArtifacts: async (_id: string, links: readonly string[]) => {
        rowWrites += 1;
        return { links } as never;
      },
    } as never,
    artifacts: {
      upload: async (_id: string, file: File) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        entries.push(file.name);
        return `memory://${file.name}`;
      },
    } as never,
  });

  const files = Array.from({ length: 9 }, (_, index) => new File([], `f${index}.png`));
  await facade.attachArtifacts("e1", files);

  assert.ok(peak <= 3, `peak concurrent uploads was ${peak}`);
  assert.equal(entries.length, 9);
  assert.equal(rowWrites, 1, "the batch is one change to the run, as documented");
});
