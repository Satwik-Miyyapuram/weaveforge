import assert from "node:assert/strict";
import test from "node:test";

import type { AppContainer } from "@/bootstrap";
import type { SearchHit } from "@weaveforge/core";
import { useHybridSearchIndex, useSearchIndex } from "@/lib/hooks/use-search-index";
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

/**
 * The hybrid arm, and why it has to be reachable at all.
 *
 * `enableSemanticSearch` downloads the encoder, embeds the whole corpus and calls
 * `container.search.setSemanticIndex(...)`. The only surface that consulted it was
 * `WorkspaceSearch.searchHybrid` — whose only callers were its own tests. Every
 * screen searched through `useSearchIndex`, which called the keyword-only
 * `search`, so the feature could complete successfully and change not one result:
 * four thousand embeddings stored, and every query still answered by keyword.
 *
 * These pin the two halves of the fix: the hybrid call happens, and it degrades to
 * the keyword ranking rather than to nothing when the encoder is absent or throws.
 */
test("the hybrid hook asks the semantic-aware search", async () => {
  const hybridCalls: string[] = [];
  const container = {
    search: {
      ensure: async () => undefined,
      search: () => [HIT],
      searchHybrid: async (query: string) => {
        hybridCalls.push(query);
        return [HIT];
      },
    },
  } as unknown as AppContainer;

  await withImmediateIdle(async () => {
    const harness = await renderHook(
      () => useHybridSearchIndex(true, { container: () => container }),
      undefined,
    );
    await harness.flush();

    const hits = await harness.current.searchHybrid("boiling");
    assert.deepEqual(hits, [HIT]);
    assert.deepEqual(hybridCalls, ["boiling"], "the semantic-aware call is the one made");
    await harness.unmount();
  });
});

test("a hybrid search that throws falls back to the keyword ranking", async () => {
  // The encoder failing is not a reason to return nothing.
  const container = {
    search: {
      ensure: async () => undefined,
      search: () => [HIT],
      searchHybrid: async () => {
        throw new Error("the encoder went away");
      },
    },
  } as unknown as AppContainer;

  await withImmediateIdle(async () => {
    const harness = await renderHook(
      () => useHybridSearchIndex(true, { container: () => container }),
      undefined,
    );
    await harness.flush();

    assert.deepEqual(await harness.current.searchHybrid("boiling"), [HIT]);
    await harness.unmount();
  });
});

test("the hybrid hook still exposes the synchronous keyword function", async () => {
  // The palette re-ranks on every keystroke and cannot await a forward pass per
  // character, so the synchronous arm has to remain available beside it.
  const container = {
    search: {
      ensure: async () => undefined,
      search: () => [HIT],
      searchHybrid: async () => [HIT],
    },
  } as unknown as AppContainer;

  await withImmediateIdle(async () => {
    const harness = await renderHook(
      () => useHybridSearchIndex(true, { container: () => container }),
      undefined,
    );
    await harness.flush();

    assert.deepEqual(harness.current.search("boiling"), [HIT], "synchronous, for typing");
    assert.equal(harness.current.ready, true);
    await harness.unmount();
  });
});
