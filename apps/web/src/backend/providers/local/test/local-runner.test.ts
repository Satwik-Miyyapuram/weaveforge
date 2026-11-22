import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { LocalRunner, localRunnerQuery } from "../parts";

/** A bridge that would answer, so a refusal can only come from the runner itself. */
function bridgeThatWouldAnswer(seen: unknown[][] = []): DesktopBridge {
  return {
    queryLocalDb: async (sql: string, params?: unknown) => {
      seen.push([sql, params]);
      return [{ id: 1 }];
    },
  } as unknown as DesktopBridge;
}

describe("the local database runner (0.9.8: removed)", () => {
  it("refuses every query, even on a desktop bridge that would answer", async () => {
    const seen: unknown[][] = [];
    await assert.rejects(new LocalRunner(bridgeThatWouldAnswer(seen)).query("select 1"), /removed in 0\.9\.8/);
    assert.deepEqual(seen, []);
  });

  it("refuses queryOne and exec the same way", async () => {
    const runner = new LocalRunner(bridgeThatWouldAnswer());
    await assert.rejects(runner.queryOne("select 1"), /removed in 0\.9\.8/);
    await assert.rejects(runner.exec("select 1"), /removed in 0\.9\.8/);
  });

  it("refuses outside the desktop app too", async () => {
    await assert.rejects(new LocalRunner(null).query("select 1"), /removed in 0\.9\.8/);
  });

  it("refuses through the shared default query", async () => {
    const run = localRunnerQuery(bridgeThatWouldAnswer());
    await assert.rejects(run("select $1", ["x"]), /removed in 0\.9\.8/);
  });
});
