import type { PostgrestSourceOptions } from "../infrastructure/postgrest-source";
import { OUTBOX_NOT_EMPTY_REASON, type ExportProgress, type ExportResult } from "./run-web-export";
import type { WebUpgradeOptions } from "./run-web-upgrade";

/** The upgrade call, injectable so the runner can be tested without a server. */
export type WebUpgradeRun = (opts: WebUpgradeOptions, onProgress?: (e: ExportProgress) => void) => Promise<ExportResult>;

/**
 * Server options the web screen supplies. `pendingOutbox` counts the local offline-sync
 * outbox rows not yet sent; any count above 0 refuses the export ("sync pending changes first").
 */
export type WebUpgradeRunnerOptions = Omit<WebUpgradeOptions, "server"> & {
  server: Omit<PostgrestSourceOptions, "pendingOutbox">;
  pendingOutbox: () => Promise<number>;
  run: WebUpgradeRun;
};

/** The export result plus `pendingSync`: true when the refusal was unsent outbox ops. */
export type WebUpgradeReply = ExportResult & { pendingSync: boolean };

/**
 * Adapter for the desktop upgrade screen's `ExportRunner` slot: `(folder, onProgress) => reply`.
 * The web has no folder, so `folder` is ignored. The reply carries `reconnectProviders`
 * (provider names only), `undecryptable`, and `pendingSync` for the screen.
 */
export function makeWebUpgradeRunner(opts: WebUpgradeRunnerOptions) {
  const { run, server, pendingOutbox, ...rest } = opts;
  return async (_folder: string, onProgress?: (e: ExportProgress) => void): Promise<WebUpgradeReply> => {
    const result = await run({ ...rest, server: { ...server, pendingOutbox } }, onProgress);
    const pendingSync = result.run.missing?.some((m) => m.reason === OUTBOX_NOT_EMPTY_REASON) ?? false;
    return { ...result, pendingSync };
  };
}
