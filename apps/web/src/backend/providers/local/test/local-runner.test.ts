import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { LocalRunner } from "../local-runner";

function bridgeReturning(rows: unknown[], seen: unknown[][] = []): DesktopBridge {
  return {
    queryLocalDb: async (sql: string, params?: unknown) => {
      seen.push([sql, params]);
      return rows;
    },
  } as unknown as DesktopBridge;
}

describe("the local database runner", () => {
  it("passes the statement and its parameters through unchanged", async () => {
    const seen: unknown[][] = [];
    const runner = new LocalRunner(bridgeReturning([{ id: 1 }], seen));
    assert.deepEqual(await runner.query("select 1 where $1", [true]), [{ id: 1 }]);
    assert.deepEqual(seen, [["select 1 where $1", [true]]]);
  });

  it("answers queryOne with null rather than undefined when nothing matched", async () => {
    assert.equal(await new LocalRunner(bridgeReturning([])).queryOne("select 1"), null);
  });

  it("says where it is, when it is asked for outside the desktop app", async () => {
    await assert.rejects(new LocalRunner(null).query("select 1"), /only available in the desktop app/);
  });
});
