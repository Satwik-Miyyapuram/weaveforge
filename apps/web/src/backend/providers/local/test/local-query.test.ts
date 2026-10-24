/**
 * One default local query (xhelp-26): the local backend, the local-first
 * backend and the device secrets store each built their own.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { LocalRunner } from "../local-runner";
import { localQuery } from "../local-query";

describe("the default local query", () => {
  it("runs the statement and parameters through the local runner", async () => {
    const seen: unknown[][] = [];
    const bridge = {
      queryLocalDb: async (sql: string, params?: unknown) => {
        seen.push([sql, params]);
        return [{ n: 1 }];
      },
    } as unknown as DesktopBridge;
    const query = localQuery(new LocalRunner(bridge));
    assert.deepEqual(await query("select $1", [2]), [{ n: 1 }]);
    assert.deepEqual(seen, [["select $1", [2]]]);
  });

  it("outside the desktop app, fails when run rather than when built", async () => {
    const query = localQuery(new LocalRunner(null));
    await assert.rejects(query("select 1", []), /only available in the desktop app/);
  });
});
