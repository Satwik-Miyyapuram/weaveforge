import { test } from "node:test";
import assert from "node:assert/strict";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { readSyncStatus } from "../ui/use-sync";
import { onLiveSyncChange, setLiveSyncState } from "../domain/live-sync";

test("a readable local database reports its sync state (34-07)", async () => {
  const status = await readSyncStatus({
    read: async () => ({ accountId: "acc", lastPullAt: "2026-01-01", watermark: 0 }) as never,
  });
  assert.deepEqual(status, { supported: true, enabled: true, accountId: "acc", lastPullAt: "2026-01-01" });
});

test("an unreadable local database reads as off, and the failure is logged (34-07)", async () => {
  await withAppLogs(async (logs) => {
    const status = await readSyncStatus({ read: () => Promise.reject(new Error("disk I/O error")) });
    assert.equal(status.supported, false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.level, "warn");
    assert.equal(logs[0]?.source, "offline-sync");
    assert.match(logs[0]?.detail ?? "", /disk I\/O error/);
  });
});

test("a listener that throws is logged and the others still hear the change (34-08)", async () => {
  await withAppLogs(async (logs) => {
    const heard: number[] = [];
    const offBad = onLiveSyncChange((s) => {
      if (s.conflictsCount === 7) throw new Error("listener broke");
    });
    const offGood = onLiveSyncChange((s) => heard.push(s.conflictsCount));
    try {
      setLiveSyncState({ conflictsCount: 7 });
      assert.deepEqual(heard.slice(-1), [7]);
      assert.equal(logs.length, 1);
      assert.match(logs[0]?.detail ?? "", /listener broke/);
    } finally {
      offBad();
      offGood();
      setLiveSyncState({ conflictsCount: 0 });
    }
  });
});
