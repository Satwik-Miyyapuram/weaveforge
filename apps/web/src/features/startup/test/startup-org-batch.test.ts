/**
 * The org batch keeps its fallbacks, but a read that failed says so (xlog-04).
 *
 * Each read fell back to null or [] with no trace, so "my lab is empty" had no
 * log line to explain it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { AppContainer } from "@/bootstrap";

import { loadOrgBatch } from "../startup-provider";

type Log = { level: string; source: string; message: string; detail?: string };

const fail = (what: string) => () => Promise.reject(new Error(`${what} timed out`));

test("every failed org read is logged and still falls back", async () => {
  const c = {
    org: { loadProfile: fail("profile"), loadTeam: fail("team"), loadLab: fail("lab") },
    projects: { listProjects: fail("projects") },
  } as unknown as AppContainer;
  const logs: Log[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  let batch;
  try {
    batch = await loadOrgBatch(c, fail("memberships"));
  } finally {
    g.window = saved;
  }
  assert.deepEqual(batch, { profile: null, team: [], labMembers: [], memberships: [] });
  assert.ok(logs.every((l) => l.level === "warn" && l.source === "startup"));
  const details = logs.map((l) => l.detail ?? "").join("\n");
  for (const what of ["profile", "team", "lab", "memberships", "projects"]) {
    assert.match(details, new RegExp(`${what} timed out`));
  }
  assert.equal(logs.length, 5);
});

test("a batch that loads logs nothing", async () => {
  const c = {
    org: { loadProfile: async () => null, loadTeam: async () => [], loadLab: async () => [] },
    projects: { listProjects: async () => [] },
  } as unknown as AppContainer;
  const logs: Log[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  try {
    await loadOrgBatch(c, async () => []);
  } finally {
    g.window = saved;
  }
  assert.deepEqual(logs, []);
});
