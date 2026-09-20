/**
 * The screen-data hook's two asynchronous writers.
 *
 * `useScreenData` shows a cached payload instantly and revalidates behind it,
 * which means three things can write to the same state: a memory-cache hit, an
 * IndexedDB restore, and the network. Only the network is allowed to be the
 * final word, and only the newest network answer counts. Both rules were
 * unenforced (review-2 C3/C6), and neither had a test until this file.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import type { Project } from "@weaveforge/core";

import { useScreenData } from "@/lib/hooks/use-screen-data";
import { clearAllScreenCaches, screenCacheKey, setScreenCache } from "@/lib/cache/screen-cache";
import { ProjectContext } from "@/features/projects/ui/project-provider";
import { createFakeIndexedDb } from "./fake-indexeddb.js";
import { renderHook } from "./react-harness.js";

interface Payload {
  label: string;
}

const PROJECT_ID = "p1";
const SCREEN = "papers";
const CACHE_KEY = screenCacheKey(PROJECT_ID, SCREEN);

/** The wrapper the hook needs: a project, without standing up the container. */
function withProject(children: ReactNode) {
  const project = { id: PROJECT_ID, name: "Project" } as unknown as Project;
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
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("screen data: a cold screen is fetched and kept in the memory cache", async () => {
  clearAllScreenCaches();
  const harness = await renderHook(
    () => useScreenData<Payload>(SCREEN, async () => ({ label: "fresh" })),
    undefined,
    { wrapper: withProject },
  );
  await harness.flush();
  assert.equal(harness.current.data?.label, "fresh");
  assert.equal(harness.current.loading, false);
  assert.equal(harness.current.error, null);
  await harness.unmount();
});

test("screen data: a fresh memory cache answers without touching the network", async () => {
  clearAllScreenCaches();
  setScreenCache(CACHE_KEY, { label: "cached" }, Date.now());
  let loads = 0;
  const harness = await renderHook(
    () =>
      useScreenData<Payload>(SCREEN, async () => {
        loads += 1;
        return { label: "network" };
      }),
    undefined,
    { wrapper: withProject },
  );
  await harness.flush();
  assert.equal(harness.current.data?.label, "cached");
  assert.equal(loads, 0, "a payload fetched seconds ago is not refetched on mount");
  await harness.unmount();
});

test("screen data: an IndexedDB payload is shown while the network is still out", async () => {
  // The other half of the rule above: the restore must still work. Guarding it
  // with the same counter the network path bumps would drop every payload it
  // reads, because the reload effect runs after this one — turning "offline
  // reopen paints instantly" into "offline reopen paints nothing".
  clearAllScreenCaches();
  const idb = createFakeIndexedDb();
  idb.seed("screens", CACHE_KEY, {
    version: 1,
    fetchedAt: Date.now(),
    value: { label: "restored" } satisfies Payload,
  });
  idb.install();
  try {
    const gate = deferred<Payload>();
    const harness = await renderHook(
      () => useScreenData<Payload>(SCREEN, () => gate.promise),
      undefined,
      { wrapper: withProject },
    );

    await idb.settle(harness.flush);
    assert.equal(
      harness.current.data?.label,
      "restored",
      "a stored payload is what makes a cold, offline start paint something",
    );
    await harness.unmount();
  } finally {
    idb.uninstall();
    clearAllScreenCaches();
  }
});

test("screen data: an IndexedDB payload cannot overwrite a fresher network answer", async () => {
  // The restore is slower than it looks on a cold start: opening the database
  // and reading the key are two steps. If it is allowed to write whenever it
  // lands, a week-old payload replaces the data that just arrived — and because
  // it is stamped with its own fetch time, the revalidation that would have
  // repaired it is suppressed too.
  clearAllScreenCaches();
  const idb = createFakeIndexedDb();
  idb.seed("screens", CACHE_KEY, {
    version: 1,
    fetchedAt: Date.now(),
    value: { label: "stale" } satisfies Payload,
  });
  idb.install();
  try {
    const gate = deferred<Payload>();
    const harness = await renderHook(
      () => useScreenData<Payload>(SCREEN, () => gate.promise),
      undefined,
      { wrapper: withProject },
    );

    gate.resolve({ label: "fresh" });
    await harness.flush();
    assert.equal(harness.current.data?.label, "fresh");

    // Only now does the IndexedDB read come back.
    await idb.settle(harness.flush);
    assert.equal(
      harness.current.data?.label,
      "fresh",
      "a payload restored after a completed load must be dropped, not applied",
    );
    await harness.unmount();
  } finally {
    idb.uninstall();
    clearAllScreenCaches();
  }
});

test("screen data: two overlapping reloads keep the newest answer", async () => {
  // Switching projects, or a manual refresh while the mount load is in flight,
  // leaves two requests open. Without a request identity the slower one wins,
  // and a project switch can paint the previous project's screen.
  clearAllScreenCaches();
  const first = deferred<Payload>();
  const second = deferred<Payload>();
  const queue = [first.promise, second.promise];
  let started = 0;
  const load = () => queue[Math.min(started++, queue.length - 1)]!;

  const harness = await renderHook(() => useScreenData<Payload>(SCREEN, load), undefined, {
    wrapper: withProject,
  });
  assert.equal(started, 1, "the mount load is in flight");

  const reloaded = harness.current.reload();
  assert.equal(started, 2, "the refresh started a second request");

  second.resolve({ label: "newest" });
  await reloaded;
  assert.equal(harness.current.data?.label, "newest");

  // The first request finally answers, after the newer one already landed.
  first.resolve({ label: "oldest" });
  await harness.flush();
  assert.equal(
    harness.current.data?.label,
    "newest",
    "a superseded request must not overwrite the answer that replaced it",
  );
  await harness.unmount();
});
