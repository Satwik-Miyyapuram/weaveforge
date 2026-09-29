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
 * ## Local-first
 *
 * A signed-in desktop whose database holds nothing of its own is adopted by the
 * account without asking: there is nothing to merge, so nothing to decide. Once
 * the first download has caught up the window is marked local-first and
 * reloaded, and from then on it reads and writes its own copy (see
 * `local-first.ts`). A database with work made before signing in is left to the
 * sync offer in Settings, which asks before merging it into an account.
 */

const CYCLE_MS = 5 * 60 * 1000;
const FOCUS_MS = 30 * 1000;

/**
 * Serialise the cycle, because three triggers can fire at once.
 *
 * Without this the interval and the `online` event can overlap: two pushes of the
 * same outbox rows race, and the second one sends what the first has already
 * sent — which the conflict store then reports as a conflict with itself. A
 * dropped tick is free; a doubled push is visible to the reader.
 *
 * Extracted and exported so that property is testable without a DOM, a database
 * or a network.
 */
/**
 * Whether this window may drive the device's outbox.
 *
 * The queued rows carry the `user_id` of the account the device was adopted by,
 * so a cycle run under a *different* session pushes one account's work as
 * another's — every row refused — and a cycle run with no session at all fails
 * the same way and leaves the queue where it was. Only the account that owns the
 * device drives it; anyone else's window stays on the server, which is what
 * "another account's copy: keep syncing it" was trying to say and did not.
 */
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

export function SyncLoop() {
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;

    let cancelled = false;
    let stop: (() => void) | undefined;

    void (async () => {
      if (isLocalMode()) return;
      const config = readBackendConfig();
      const client = createSupabaseClient(config.supabaseUrl ?? "", config.supabaseAnonKey ?? "");
      const runner = new LocalRunner();
      const state = new SyncStateStore(runner);
      let current = await state.read();
      const { data } = await client.auth.getSession();
      const signedIn = data.session?.user ?? null;

      if (current.accountId === null) {
        // Not adopted: there is no account for the outbox to belong to, and
        // asking the server would be a request per tick that can only be refused.
        if (cancelled || !signedIn || !(await nothingOfItsOwn(runner))) return;
        await enableSync();
        current = await state.read();
        if (current.accountId === null) return;
      }
      if (cancelled) return;

      // This window's session has to be the account the device belongs to. A
      // window signed in as somebody else — or signed out — must not pump, and
      // it shows the server rather than someone else's local copy.
      const owner = mayDriveDevice(signedIn?.id ?? null, current.accountId) ? signedIn : null;
      if (!owner) return;

      const engine = syncEngine(liveAccessToken(client));

      const settle = (result: CycleResult) => {
        const caughtUp = result.pushed.stoppedBecause === null && !result.pulled.more;
        if (caughtUp && owner && localFirstAccount()?.id !== owner.id) {
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
        try {
          settle(await engine.cycle());
        } catch {
          // A cycle that throws has already recorded what it could: the puller
          // writes `lastPullAt` on success and leaves the watermark alone on
          // failure, so the next tick resumes from the same place. There is
          // nothing here for the reader to act on mid-session, and the settings
          // row shows the age of the last successful pull.
        }
      });

      void cycle();

      const onOnline = () => void cycle();
      const onFocus = () => {
        if (Date.now() - lastRun >= FOCUS_MS) void cycle();
      };
      window.addEventListener("online", onOnline);
      window.addEventListener("focus", onFocus);
      const timer = window.setInterval(() => void cycle(), CYCLE_MS);

      stop = () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("focus", onFocus);
        window.clearInterval(timer);
      };
      // The effect may have been torn down while the adoption state was loading.
      if (cancelled) stop();
    })().catch(() => undefined);

    return () => {
      cancelled = true;
      stop?.();
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
