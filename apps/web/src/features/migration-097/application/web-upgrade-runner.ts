import type { PostgrestSourceOptions } from "../infrastructure/postgrest-source";
import type { ExportProgress, ExportResult } from "./run-web-export";
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

/**
 * Adapter for the desktop upgrade screen's `ExportRunner` slot: `(folder, onProgress) => { state }`.
 * The web has no folder, so `folder` is ignored. The result also carries `reconnectProviders`
 * (provider names only) for the screen's reconnect list.
 */
export function makeWebUpgradeRunner(opts: WebUpgradeRunnerOptions) {
  const { run, server, pendingOutbox, ...rest } = opts;
  return (_folder: string, onProgress?: (e: ExportProgress) => void): Promise<ExportResult> =>
    run({ ...rest, server: { ...server, pendingOutbox } }, onProgress);
}
