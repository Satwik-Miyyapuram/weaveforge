/**
 * Sync status was shown only on conflict, so a person could not tell synced
 * from offline from still syncing (design D21, DA-133, D-13). The account
 * menu now says the state in words; the sidebar keeps no dot of its own.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { syncStatus } from "../domain/sync-status";

const now = new Date("2026-10-27T12:00:00");
const base = { phase: "idle", enabled: true, isOnline: true, conflictsCount: 0, lastSyncAt: null } as const;

test("synced says when, in words", () => {
  const s = syncStatus({ ...base, lastSyncAt: new Date("2026-10-27T11:58:00").getTime() }, now);
  assert.deepEqual(s, { state: "synced", label: "Synced", tip: "Synced 2m ago. Click to sync now." });
  assert.equal(syncStatus(base, now)?.tip, "Synced. Click to sync now.", "no time before the first sync");
});

test("syncing, offline and conflicts each have their own state", () => {
  assert.equal(syncStatus({ ...base, phase: "syncing" }, now)?.state, "syncing");
  assert.equal(syncStatus({ ...base, isOnline: false }, now)?.state, "offline");
  assert.equal(syncStatus({ ...base, phase: "offline" }, now)?.state, "offline");
  const c = syncStatus({ ...base, conflictsCount: 2, phase: "syncing" }, now);
  assert.equal(c?.state, "conflict", "a conflict outranks every other state");
  assert.equal(c?.label, "2 conflicts");
  assert.equal(syncStatus({ ...base, conflictsCount: 1 }, now)?.label, "1 conflict");
});

test("an account without sync shows nothing", () => {
  assert.equal(syncStatus({ ...base, enabled: false }, now), null);
  assert.equal(syncStatus({ ...base, enabled: false, isOnline: false }, now)?.state, "offline", "offline still matters");
});

test("the account menu says the sync state in words", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");
  const menu = read("app/header-actions.tsx");
  assert.match(menu, /syncStatus\(/, "the menu reads its words from syncStatus");
  assert.match(menu, /className="account-menu-sync"/);
  const ui = read("features/offline-sync/ui/sync-status-indicator.tsx");
  assert.doesNotMatch(ui, /quiet/, "no quiet dot mode is left");
});

test("a failed sync says so rather than Synced", () => {
  // The loop sets phase "error" when a cycle throws while online; the menu fell
  // through to "Synced" and hid the failure.
  const s = syncStatus({ ...base, phase: "error", lastSyncAt: new Date("2026-10-27T11:58:00").getTime() }, now);
  assert.equal(s?.state, "error");
  assert.equal(s?.label, "Sync failed");
  assert.match(s?.tip ?? "", /try again/i);
  const ui = readFileSync(fileURLToPath(new URL("../ui/sync-status-indicator.tsx", import.meta.url)), "utf8");
  assert.match(ui, /error: "amber"/, "the indicator gives the failure its own dot");
});
