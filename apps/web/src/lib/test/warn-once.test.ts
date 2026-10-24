/**
 * A best-effort cache write that fails says so once (xlog-08): silent before,
 * but logged on every write it would flood the log during a quota problem.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { warnOnce } from "@/lib/error-report/warn-once";

type Log = { level: string; source: string; message: string; detail?: string };

test("warnOnce logs the first failure per source and message, and no repeats", () => {
  const logs: Log[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  try {
    warnOnce("search", "Vectors were not saved.", new Error("QuotaExceededError"));
    warnOnce("search", "Vectors were not saved.", new Error("again"));
    warnOnce("search", "The search index was not saved.", new Error("other"));
  } finally {
    g.window = saved;
  }
  assert.equal(logs.length, 2);
  assert.deepEqual(
    logs.map((l) => [l.level, l.source, l.message]),
    [
      ["warn", "search", "Vectors were not saved."],
      ["warn", "search", "The search index was not saved."],
    ],
  );
  assert.match(logs[0]!.detail ?? "", /QuotaExceededError/);
});
