/**
 * A change the server keeps refusing is dead-lettered during a sync cycle,
 * not when a conflict opens. The Sync settings panel listed it only after a
 * reload, because it re-read on conflict count alone. It now re-reads when a
 * cycle ends.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { useSyncIssues, type SyncIssues } from "../ui/use-sync-issues";
import { setLiveSyncState } from "../domain/live-sync";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

test("a change dead-lettered by a sync cycle shows without a reload", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g.window;
  const dead: Record<string, unknown>[] = [];
  g.window = {
    weaveforge: {
      fetchTitle() {},
      queryLocalDb: async (sql: string) => (sql.includes("from sync_outbox") ? [...dead] : []),
    },
  };
  let seen: SyncIssues | undefined;
  function Probe() {
    seen = useSyncIssues().issues;
    return null;
  }
  try {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => { tree = create(createElement(Probe)); });
    await flush();
    assert.equal(seen?.dead.length, 0, "nothing outstanding at first");

    // The cycle refuses an insert for the last time; no conflict opens.
    setLiveSyncState({ phase: "syncing" });
    dead.push({
      seq: 1, op_id: "op-1", table_name: "vault_pages", row_id: "row-1", op: "insert",
      payload: {}, base_version: null, base_payload: null, attempts: 8, last_error: "refused",
    });
    await act(async () => { setLiveSyncState({ phase: "idle", lastSyncAt: Date.now() }); });
    await flush();

    assert.equal(seen?.dead.length, 1, "the refused change is listed");
    await act(async () => tree!.unmount());
  } finally {
    g.window = saved;
    setLiveSyncState({ phase: "idle" });
  }
});
