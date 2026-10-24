/**
 * Logbook side effects (B65).
 *
 * - 29-07: a failed delete answers the error to show, rather than rejecting
 *   into a `void` click handler.
 * - 29-13: a failed git push or chat post is logged, not swallowed.
 * - 29-09: `bodyContains` adds no server filter; the decrypting repository
 *   filters after the read.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LogEntry } from "@weaveforge/core";

import { bestEffort, removeLogEntry } from "../application/log-side-effects";
import { PostgrestLogEntryRepository } from "../infrastructure/postgrest-log-entry-repository";

type Log = { level: string; source: string; message: string; detail?: string };

async function capturingLogs(run: () => Promise<void>): Promise<Log[]> {
  const logs: Log[] = [];
  const g = globalThis as { window?: unknown };
  const original = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  try {
    await run();
  } finally {
    g.window = original;
  }
  return logs;
}

const entry = { id: "l1", body: "did things", kind: "daily", entryDate: "2026-10-24" } as LogEntry;

test("bestEffort logs a failure and does not throw (29-13)", async () => {
  const logs = await capturingLogs(() => bestEffort("Git push", () => Promise.reject(new Error("no remote"))));
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.source, "logbook");
  assert.match(logs[0]!.message, /Git push/);
  assert.match(logs[0]!.detail ?? "", /no remote/);
});

test("bestEffort logs nothing when the task succeeds", async () => {
  let ran = false;
  const logs = await capturingLogs(() =>
    bestEffort("Git push", async () => {
      ran = true;
    }),
  );
  assert.ok(ran);
  assert.deepEqual(logs, []);
});

test("a failed delete answers its error and skips the git removal (29-07)", async () => {
  const calls: string[] = [];
  const problem = await removeLogEntry(
    {
      addLogEntry: { remove: () => Promise.reject(new Error("offline")) },
      removeLog: async () => void calls.push("git"),
    },
    entry,
  );
  assert.match(problem ?? "", /offline/);
  assert.deepEqual(calls, []);
});

test("a delete whose git removal fails still succeeds, and logs it", async () => {
  let problem: string | null = "unset";
  const logs = await capturingLogs(async () => {
    problem = await removeLogEntry(
      { addLogEntry: { remove: async () => {} }, removeLog: () => Promise.reject(new Error("locked")) },
      entry,
    );
  });
  assert.equal(problem, null);
  assert.equal(logs.length, 1);
  assert.match(logs[0]!.detail ?? "", /locked/);
});

test("bodyContains adds no server filter (29-09)", async () => {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lte", "ilike", "like", "textSearch", "or", "order"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push(`${method}:${String(args[0])}`);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  const db = { from: () => builder } as unknown as SupabaseClient;
  const repo = new PostgrestLogEntryRepository(db, { projectId: "p1" } as never);
  assert.deepEqual(await repo.list({ bodyContains: "secret" }), []);
  assert.ok(!calls.some((c) => /^(ilike|like|textSearch|or):/.test(c)), calls.join(", "));
});
