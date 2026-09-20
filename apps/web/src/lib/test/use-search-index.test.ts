import assert from "node:assert/strict";
import test from "node:test";

import type { AppContainer } from "@/bootstrap";
import type { SearchHit } from "@weaveforge/core";
import { useSearchIndex } from "@/lib/hooks/use-search-index";
import { renderHook } from "./react-harness.js";

/**
 * The search hook's readiness flag — `BUG-18`.
 *
 * `ready` is what tells a caller it may use the ranked path instead of its
 * substring fallback. It used to be set in a `finally`, so a build that *failed*
 * (a worker that will not start, a corrupt IndexedDB, a refused snapshot read)
 * also flipped it: every screen then got an empty result set from the ranked
 * path, with the fallback switched off and no retry. Silent, and the opposite of
 * what the hook's own docstring promised.
 *
 * The hook had no test for this because it reached for the real container, whose
 * build succeeds on any machine with a worker and a healthy database — so the
 * failure branch was reachable only in production. It takes the container now.
 */

const HIT: SearchHit = {
  id: "note:n1",
  kind: "note",
  entityId: "n1",
  title: "Boiling water",
  href: "/notes/n1",
  score: 1,
  excerpt: "",
  terms: [],
} as unknown as SearchHit;

function containerWith(build: () => Promise<unknown>) {
  const searched: string[] = [];
  const container = {
    search: {
      ensure: build,
      search: (query: string) => {
        searched.push(query);
        return [HIT];
      },
    },
  } as unknown as AppContainer;
  return { container: () => container, searched };
}

/**
 * The hook defers its build to an idle callback. Install one that runs it now:
 * the alternative is a 200ms timer, which turns every assertion below into a
 * race.
 */
async function withImmediateIdle(fn: () => Promise<void>): Promise<void> {
  const scope = globalThis as { requestIdleCallback?: unknown };
  const original = scope.requestIdleCallback;
  scope.requestIdleCallback = (callback: () => void) => {
    callback();
    return 1;
  };
  try {
    await fn();
  } finally {
    if (original === undefined) delete scope.requestIdleCallback;
    else scope.requestIdleCallback = original;
  }
}

test("a build that fails leaves the hook not ready, so callers keep their fallback", async () => {
  const { container, searched } = containerWith(async () => {
    throw new Error("the worker would not start");
  });

  await withImmediateIdle(async () => {
    const harness = await renderHook(() => useSearchIndex(true, { container }), undefined);
    await harness.flush();

    assert.deepEqual(harness.current("boiling"), [], "no ranked answer to give");
    assert.deepEqual(searched, [], "and it did not pretend to rank — the fallback stays in charge");
    await harness.unmount();
  });
});

test("a build that succeeds is ranked through", async () => {
  const { container, searched } = containerWith(async () => undefined);

  await withImmediateIdle(async () => {
    const harness = await renderHook(() => useSearchIndex(true, { container }), undefined);
    await harness.flush();

    assert.deepEqual(harness.current("boiling"), [HIT]);
    assert.deepEqual(searched, ["boiling"]);
    await harness.unmount();
  });
});

test("a search that throws costs the ranking, not the caller", async () => {
  // The same promise the docstring makes for the build: the box keeps working.
  const container = {
    search: {
      ensure: async () => undefined,
      search: () => {
        throw new Error("index went away");
      },
    },
  } as unknown as AppContainer;

  await withImmediateIdle(async () => {
    const harness = await renderHook(() => useSearchIndex(true, { container: () => container }), undefined);
    await harness.flush();

    assert.deepEqual(harness.current("boiling"), []);
    await harness.unmount();
  });
});
