"use client";

import { useEffect } from "react";

import { readBackendConfig } from "@/backend/config";
import { createSupabaseClient } from "@/backend/providers/supabase/client";
import { LocalRunner } from "@/backend/providers/local/local-runner";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { SyncStateStore } from "../domain/sync-state";
import { liveAccessToken } from "./enable-sync";
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
 * not a chat client, and each cycle is a push plus a pull.
 */

const CYCLE_MS = 5 * 60 * 1000;

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
      const state = new SyncStateStore(new LocalRunner());
      const current = await state.read();
      // Not adopted: there is no account for the outbox to belong to, and asking
      // the server would be a request per tick that can only be refused.
      if (cancelled || current.accountId === null) return;

      const config = readBackendConfig();
      const client = createSupabaseClient(config.supabaseUrl ?? "", config.supabaseAnonKey ?? "");
      const engine = syncEngine(liveAccessToken(client));

      const cycle = createCycleRunner(async () => {
        try {
          await engine.cycle();
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
      window.addEventListener("online", onOnline);
      const timer = window.setInterval(() => void cycle(), CYCLE_MS);

      stop = () => {
        window.removeEventListener("online", onOnline);
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
