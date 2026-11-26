import assert from "node:assert/strict";
import { test } from "node:test";

import { startCitationAlerts } from "../start-citation-alerts";

/** F97-P2-22: the citation-alert kickoff never leaves an unhandled rejection. */

type Load = NonNullable<Parameters<typeof startCitationAlerts>[2]>;

function bootstrap(over: { ensure?: () => Promise<void>; projectId?: string; check?: () => Promise<void> }) {
  let checks = 0;
  const load: Load = async () =>
    ({
      ensureContainer: over.ensure ?? (async () => undefined),
      getContainer: () => ({
        projects: { context: { projectId: over.projectId ?? "p1" } },
        papers: {
          checkCitationAlerts: async () => {
            checks += 1;
            await over.check?.();
          },
        },
      }),
    }) as never;
  return { load, checks: () => checks };
}

test("a container that fails to start is logged, not thrown", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const boom = new Error("container down");
  const { load, checks } = bootstrap({ ensure: () => Promise.reject(boom) });
  await startCitationAlerts("p1", () => false, load);
  assert.equal(checks(), 0);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0]!.arguments[1], boom);
});

test("a chunk that fails to load is logged, not thrown", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  await startCitationAlerts("p1", () => false, () => Promise.reject(new Error("ChunkLoadError")));
  assert.equal(warn.mock.callCount(), 1);
});

test("a failing check is logged, not thrown", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const { load, checks } = bootstrap({ check: () => Promise.reject(new Error("offline")) });
  await startCitationAlerts("p1", () => false, load);
  assert.equal(checks(), 1);
  assert.equal(warn.mock.callCount(), 1);
});

test("runs the check for the open project only, and not once cancelled", async () => {
  const open = bootstrap({});
  await startCitationAlerts("p1", () => false, open.load);
  assert.equal(open.checks(), 1);

  const other = bootstrap({ projectId: "p2" });
  await startCitationAlerts("p1", () => false, other.load);
  assert.equal(other.checks(), 0);

  const gone = bootstrap({});
  await startCitationAlerts("p1", () => true, gone.load);
  assert.equal(gone.checks(), 0);
});
