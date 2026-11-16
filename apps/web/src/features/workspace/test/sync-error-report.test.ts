/**
 * A failed folder sync is logged, not kept in a list nobody reads (B65, 29-06).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { NO_ACTIVE_PROJECT_MESSAGE, NoActiveProjectError, isNoActiveProject } from "../application/parts";
import { reportSyncError } from "../application/workspace-folder";

type Log = { level: string; source: string; message: string; detail?: string };

test("no open project is a state to describe, not a failed sync", () => {
  const logs: Log[] = [];
  const g = globalThis as { window?: unknown };
  const original = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  try {
    reportSyncError(new NoActiveProjectError());
  } finally {
    g.window = original;
  }
  assert.deepEqual(logs, []);
});

test("the no-project error is recognised, a real failure is not", () => {
  assert.equal(isNoActiveProject(new NoActiveProjectError()), true);
  assert.equal(isNoActiveProject(new Error("disk full")), false);
  assert.equal(new NoActiveProjectError().message, NO_ACTIVE_PROJECT_MESSAGE);
});

test("a failed folder sync is logged as a warning", () => {
  const logs: Log[] = [];
  const g = globalThis as { window?: unknown };
  const original = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  try {
    reportSyncError(new Error("disk full"));
    reportSyncError("not an Error");
  } finally {
    g.window = original;
  }
  assert.equal(logs.length, 2);
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.source, "workspace-sync");
  assert.match(logs[0]!.detail ?? "", /disk full/);
  assert.match(logs[1]!.detail ?? "", /not an Error/);
});

test("reporting a sync error outside the desktop app does not throw", () => {
  assert.doesNotThrow(() => reportSyncError(new Error("x")));
});
