/**
 * Startup reads that fail fall back, and say so (B65, 29-08).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loggedFallback } from "../logged-fallback";

type Log = { level: string; source: string; message: string; detail?: string };

function withLogs(run: () => Promise<void>): Promise<Log[]> {
  const logs: Log[] = [];
  const g = globalThis as { window?: unknown };
  const original = g.window;
  g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
  return run().then(
    () => {
      g.window = original;
      return logs;
    },
    (err: unknown) => {
      g.window = original;
      throw err;
    },
  );
}

test("a failed read answers its fallback and logs why", async () => {
  let got: unknown;
  const logs = await withLogs(async () => {
    got = await Promise.reject(new Error("503")).catch(loggedFallback("Team", [] as string[]));
  });
  assert.deepEqual(got, []);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.source, "startup");
  assert.match(logs[0]!.message, /Team/);
  assert.match(logs[0]!.detail ?? "", /503/);
});

test("a read that succeeds logs nothing", async () => {
  let got: unknown;
  const logs = await withLogs(async () => {
    got = await Promise.resolve("me").catch(loggedFallback("Profile", null));
  });
  assert.equal(got, "me");
  assert.deepEqual(logs, []);
});
