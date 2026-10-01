"use client";

import { useEffect } from "react";

import { readBackendConfig } from "@/backend/config";
import { createSupabaseClient } from "@/backend/providers/supabase/client";
import { LocalRunner } from "@/backend/providers/local/local-runner";
import { isLocalMode } from "@/backend/providers/local/local-identity";
import { localFirstAccount, setLocalFirstAccount } from "@/backend/providers/local/local-first-marker";
import { invalidateAllRepoCaches } from "@/lib/cache/project-lww-invalidator";
import { clearAllScreenCaches } from "@/lib/cache/screen-cache";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { SyncStateStore } from "../domain/sync-state";
import type { CycleResult } from "../domain/sync-engine";
import { enableSync, liveAccessToken } from "./enable-sync";
import { syncEngine } from "./use-sync";

/**
 * The outbox pump, actually pumping.
 *
 * `SyncEngine.cycle()` had no production caller — its only callers were its own
 * tests — so local-first writes were never enqueued and never drained in a
 * shipped app. Turning sync on in Settings installed machinery that nothing
 * drove, which is worse than not offering it: the reader is told their work will
 * sync and it will not.
 *
 * ## Where this runs, and why here
 *
 * The desktop app, from the shell, for as long as it is open. Not the settings
 * screen: a pump that only runs while a settings panel is mounted drains nothing
 * on the day somebody actually works offline. Not the browser: there is no local
 * database to adopt and therefore nothing to drain.
 *
 * `SyncLoop` is imported through a lazy boundary (`sync-loop-lazy.tsx`), because
 * the engine, the transport and the Supabase client are a sizeable chunk and the
 * shell mounts on every route. That is the same reasoning as `bundle:budget`,
 * applied to the thing this file adds.
 *
 * ## The three triggers
 *
 * Once on open (there may be a backlog from the last session), whenever the
 * browser says the network came back, and on a slow interval for the case nobody
 * announces — a socket that died without an event, a token that expired quietly.
 * Five minutes is slow on purpose: this is a single-user research app's outbox,
 * not a chat client, and each cycle is a push plus a pull. Coming back to the
 * window also syncs, at most every thirty seconds, since that is when someone
 * expects to see what they did elsewhere.
 *
 * ## Signing in
 *
 * Signing in merges this device's branch with the account's: local work is
 * adopted (colliding project names kept side by side), pushed, and the account's
 * rows pulled, with rows changed on both sides merged field by field. Only a
 * field both sides changed differently waits for a person. Once caught up the
 * window is marked local-first and reloaded (see `local-first.ts`). Signing out
 * stops the loop; a window signed in as another account never drives it.
 */

import { onWorkspaceChange } from "@/lib/workspace-changes";
import { setLiveSyncState, registerSyncTrigger } from "../domain/live-sync";
import { ConflictStore } from "../domain/conflicts";

const CYCLE_MS = 45 * 1000;
const FOCUS_MS = 15 * 1000;
const DEBOUNCE_CHANGE_MS = 1500;
const BOOT_RETRY_MS = 30 * 1000;

export function mayDriveDevice(
  signedInUserId: string | null,
  adoptedAccountId: string | null,
): boolean {
  return adoptedAccountId !== null && signedInUserId === adoptedAccountId;
}

export function createCycleRunner(run: () => Promise<void>): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await run();
    } finally {
      // In `finally` so a failed cycle does not wedge the loop shut: the next
      // tick is the retry.
      running = false;
    }
  };
}

/** What a window does for the session it holds: the device's account drives it. */
export type SessionAction = "idle" | "adopt" | "drive" | "foreign";

export function sessionAction(
  signedInUserId: string | null,
  adoptedAccountId: string | null,
): SessionAction {
  if (!signedInUserId) return "idle";
  if (adoptedAccountId === null) return "adopt";
  return mayDriveDevice(signedInUserId, adoptedAccountId) ? "drive" : "foreign";
}

export function SyncLoop() {
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    if (isLocalMode()) {
      setLiveSyncState({ phase: "offline", enabled: false, isOnline: false });
      return;
    }

    const config = readBackendConfig();
    const client = createSupabaseClient(config.supabaseUrl ?? "", config.supabaseAnonKey ?? "");
    const runner = new LocalRunner();
    const state = new SyncStateStore(runner);
    let cancelled = false;
    let stop: (() => void) | undefined;
    let drivenBy: string | null = null;
    // Auth events arrive in bursts; each boot waits for the one before it.
    let booting: Promise<void> = Promise.resolve();

    const halt = () => {
      stop?.();
      stop = undefined;
      drivenBy = null;
    };

    const boot = async (user: { id: string; email?: string | null } | null) => {
      if (cancelled) return;
      if (user && drivenBy === user.id) return;
      halt();
      let current = await state.read();
      let action = sessionAction(user?.id ?? null, current.accountId);
      if (action === "adopt") {
        // Signing in merges the two branches: local work joins the account,
        // name collisions are kept side by side, and the first cycle pulls the rest.
        setLiveSyncState({ phase: "syncing" });
        const adopted = await enableSync();
        setLiveSyncState({ lastAdoption: adopted });
        current = await state.read();
        action = sessionAction(user?.id ?? null, current.accountId);
      }
      if (cancelled) return;
      if (action !== "drive" || !user) {
        setLiveSyncState({ enabled: false, accountId: current.accountId, phase: "idle" });
        return;
      }
      drivenBy = user.id;
      stop = drive(user);
    };

    const drive = (owner: { id: string; email?: string | null }) => {
      setLiveSyncState({
        enabled: true,
        accountId: owner.id,
        phase: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "idle",
        isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
      });

      const conflictStore = new ConflictStore(runner);
      const updateConflicts = async () => {
        const open = await conflictStore.openConflicts().catch(() => []);
        // Only rows the puller has compared need a person; the rest settle themselves.
        setLiveSyncState({ conflictsCount: open.filter((c) => c.fields.length > 0).length });
      };

      const engine = syncEngine(liveAccessToken(client));

      const settle = (result: CycleResult) => {
        const caughtUp = result.pushed.stoppedBecause === null && !result.pulled.more;
        if (caughtUp && localFirstAccount()?.id !== owner.id) {
          setLocalFirstAccount({ id: owner.id, email: owner.email ?? null });
          window.location.reload();
          return;
        }
        // What arrived is already on disk; the screens still hold what they read.
        if (result.pulled.applied > 0) {
          invalidateAllRepoCaches();
          clearAllScreenCaches();
        }
      };

      let lastRun = 0;
      const cycle = createCycleRunner(async () => {
        lastRun = Date.now();
        setLiveSyncState({ phase: "syncing" });
        try {
          settle(await engine.cycle());
          setLiveSyncState({ phase: "idle", lastSyncAt: Date.now(), isOnline: true });
        } catch {
          // The puller leaves the watermark alone on failure; the next tick retries.
          setLiveSyncState({
            phase: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error",
            isOnline: typeof navigator !== "undefined" ? navigator.onLine : false,
          });
        }
        void updateConflicts();
      });

      const unregisterTrigger = registerSyncTrigger(() => void cycle());
      void cycle();

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const unsubChange = onWorkspaceChange(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => void cycle(), DEBOUNCE_CHANGE_MS);
      });

      const onOnline = () => {
        setLiveSyncState({ isOnline: true });
        void cycle();
      };
      const onOffline = () => setLiveSyncState({ isOnline: false, phase: "offline" });
      const onFocus = () => {
        if (Date.now() - lastRun >= FOCUS_MS) void cycle();
      };
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      window.addEventListener("focus", onFocus);
      const timer = window.setInterval(() => void cycle(), CYCLE_MS);

      return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
        window.removeEventListener("focus", onFocus);
        window.clearInterval(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        unsubChange();
        unregisterTrigger();
      };
    };

    let retry: ReturnType<typeof setTimeout> | null = null;
    const queue = (user: { id: string; email?: string | null } | null) => {
      if (retry) clearTimeout(retry);
      retry = null;
      booting = booting.then(() => boot(user)).catch(() => {
        setLiveSyncState({ phase: "error" });
        // A merge that failed (offline at sign-in) tries again rather than waiting for the next sign-in.
        if (user && !cancelled) retry = setTimeout(() => queue(user), BOOT_RETRY_MS);
      });
    };

    // Signing in or out while the window is open starts or stops the loop.
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        queue(null);
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        queue(session?.user ?? null);
      }
    });

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      sub.subscription.unsubscribe();
      halt();
    };
  }, []);

  return null;
}

/**
 * The synced tables that carry an owner, read from the registry rather than
 * listed here — so a table added to the sync set cannot be forgotten below.
 */
export const OWNED_SYNC_TABLES_SQL = `select s.table_name from sync_tables s
   where exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = s.table_name
                    and c.column_name = 'user_id')
   order by s.table_name`;

/**
 * One count per table, summed. Null when there is nothing to count, which is
 * also "nothing of its own".
 */
export function ownedRowCountSql(tables: readonly string[]): string | null {
  if (tables.length === 0) return null;
  const one = (table: string) =>
    `select count(*)::int as n from "${table.replace(/"/g, '""')}" where user_id = $1`;
  return `select coalesce(sum(n), 0)::int as n from (${tables.map(one).join(" union all ")}) owned`;
}

/**
 * Whether the local database holds no work made before signing in.
 *
 * This decides whether a device may be adopted *without asking*, so it has to
 * see all of the work adoption would move. It used to look at `projects` and
 * `papers` only: a workspace whose entire local history was notes — or
 * experiments, or a reading list — answered "nothing of its own" and was merged
 * into an account silently.
 */
async function nothingOfItsOwn(runner: LocalRunner): Promise<boolean> {
  const tables = await runner.query<{ table_name: string }>(OWNED_SYNC_TABLES_SQL);
  const sql = ownedRowCountSql(tables.map((table) => table.table_name));
  if (!sql) return true;
  const rows = await runner.query<{ n: number }>(sql, [LOCAL_USER_ID]);
  return (rows[0]?.n ?? 0) === 0;
}
