/**
 * The first project load (27-02): a failed `listProjects` ends the loading
 * state and is logged, rather than leaving an unhandled rejection behind.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Project } from "@weaveforge/core";
import { loadInitialProject } from "../ui/project-provider";

type Log = { level: string; source: string; message: string; detail?: string };

async function withDesktopLog(run: () => Promise<void>): Promise<Log[]> {
  const logs: Log[] = [];
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: () => null },
    weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (entry: Log) => void logs.push(entry) },
  };
  try {
    await run();
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
  return logs;
}

test("a rejected project list ends loading and is logged", async () => {
  let done = 0;
  const selected: (string | null)[] = [];
  const logs = await withDesktopLog(() =>
    loadInitialProject({
      refresh: () => Promise.reject(new Error("offline")),
      storedId: () => "p1",
      select: (id) => void selected.push(id),
      done: () => void (done += 1),
    }),
  );
  assert.equal(done, 1);
  assert.deepEqual(selected, []);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.match(logs[0]!.detail ?? "", /offline/);
});

test("a stored project that still exists is selected", async () => {
  let done = 0;
  const selected: (string | null)[] = [];
  const logs = await withDesktopLog(() =>
    loadInitialProject({
      refresh: async () => [{ id: "p1" } as Project],
      storedId: () => "p1",
      select: (id) => void selected.push(id),
      done: () => void (done += 1),
    }),
  );
  assert.deepEqual(selected, ["p1"]);
  assert.equal(done, 1);
  assert.deepEqual(logs, []);
});

test("a stored project that is gone is not selected", async () => {
  const selected: (string | null)[] = [];
  await withDesktopLog(() =>
    loadInitialProject({
      refresh: async () => [{ id: "p2" } as Project, { id: "p3" } as Project],
      storedId: () => "p1",
      select: (id) => void selected.push(id),
      done: () => {},
    }),
  );
  assert.deepEqual(selected, []);
});

test("a project already open from the saved list is not selected again", async () => {
  const selected: (string | null)[] = [];
  await withDesktopLog(() =>
    loadInitialProject({
      refresh: async () => [{ id: "p1" } as Project],
      storedId: () => "p1",
      select: (id) => void selected.push(id),
      selected: () => "p1",
      done: () => undefined,
    }),
  );
  assert.deepEqual(selected, []);
});

test("a saved project the live list no longer has is closed", async () => {
  const selected: (string | null)[] = [];
  await withDesktopLog(() =>
    loadInitialProject({
      refresh: async () => [{ id: "p2" } as Project, { id: "p3" } as Project],
      storedId: () => "p1",
      select: (id) => void selected.push(id),
      selected: () => "p1",
      done: () => undefined,
    }),
  );
  assert.deepEqual(selected, [null]);
});

test("with the stored project gone and one project left, that one opens", async () => {
  const selected: (string | null)[] = [];
  await withDesktopLog(() =>
    loadInitialProject({
      refresh: async () => [{ id: "Thesis" } as Project],
      storedId: () => "8d731734-bdcd-4f08-b648-efd15fdf75da",
      select: (id) => void selected.push(id),
      done: () => undefined,
    }),
  );
  assert.deepEqual(selected, ["Thesis"]);
});

test("with nothing stored and no projects, nothing opens", async () => {
  const selected: (string | null)[] = [];
  await withDesktopLog(() =>
    loadInitialProject({ refresh: async () => [], storedId: () => null, select: (id) => void selected.push(id), done: () => undefined }),
  );
  assert.deepEqual(selected, []);
});
