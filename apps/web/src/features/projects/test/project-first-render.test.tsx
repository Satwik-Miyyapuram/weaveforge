/**
 * A screen's first load must see the project reopened from this device.
 *
 * The provider used to pick the saved project in its own effect. A parent's
 * effects run after its children's, so every screen's first load ran with no
 * project, was cancelled one render later and ran again: the workspace loaded
 * twice and its open tabs restored twice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { useEffect } from "react";

import type { AppContainer } from "@/bootstrap";
import { setContainerForTests } from "@/bootstrap";
import { renderHook } from "@/lib/test/react-harness";
import { ProjectProvider, useProject } from "../ui/project-provider";

const P1 = { id: "p1", name: "Thesis" };

function withDesktop(items: Record<string, string>) {
  const store = new Map(Object.entries(items));
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const host = globalThis as { window?: unknown; localStorage?: unknown };
  const before = { window: host.window, localStorage: host.localStorage };
  host.window = { localStorage, weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: () => {} } };
  host.localStorage = localStorage;
  return () => {
    host.window = before.window;
    host.localStorage = before.localStorage;
  };
}

function fakeContainer(watched: (string | null)[]) {
  const projects = {
    context: { projectId: null as string | null },
    watchProject: (id: string | null) => void watched.push(id),
    listProjects: async () => [P1],
  };
  return { projects } as unknown as AppContainer;
}

/** The project ids a child's effects saw, in order. */
async function effectsSeen(items: Record<string, string>) {
  const restore = withDesktop(items);
  const watched: (string | null)[] = [];
  const container = fakeContainer(watched);
  setContainerForTests(container);
  const seen: (string | null)[] = [];
  try {
    const h = await renderHook(
      () => {
        const id = useProject().current?.id ?? null;
        useEffect(() => void seen.push(id), [id]);
        return id;
      },
      undefined,
      { wrapper: (children) => <ProjectProvider>{children}</ProjectProvider> },
    );
    await h.flush();
    await h.unmount();
    return { seen, watched, contextId: container.projects.context.projectId };
  } finally {
    setContainerForTests(null);
    restore();
  }
}

const SNAPSHOT = { "weaveforge.snapshot.projects": JSON.stringify({ v: 1, value: [P1] }) };

test("a saved project is current on the first render", async () => {
  const { seen, watched, contextId } = await effectsSeen({ "thesis.projectId": "p1", ...SNAPSHOT });
  assert.deepEqual(seen, ["p1"]);
  assert.deepEqual(watched, ["p1"]);
  assert.equal(contextId, "p1");
});

test("a saved id missing from the snapshot waits for the live list", async () => {
  const { seen } = await effectsSeen({ "thesis.projectId": "p1" });
  assert.deepEqual(seen, [null, "p1"]);
});

test("no saved id opens no project", async () => {
  const { seen, watched } = await effectsSeen(SNAPSHOT);
  assert.deepEqual(seen, [null]);
  assert.deepEqual(watched, []);
});
