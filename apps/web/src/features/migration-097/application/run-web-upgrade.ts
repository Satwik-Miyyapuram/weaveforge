import type { KindWriter } from "../domain/kind-writer";
import type { FileCodec, FileSink } from "../domain/ports";
import { PostgrestSource, type PostgrestSourceOptions } from "../infrastructure/postgrest-source";
import { runWebExport, type ExportProgress, type ExportResult } from "./run-web-export";

export type WebUpgradeOptions = {
  /** The owner's PostgREST connection (the server source). */
  server: PostgrestSourceOptions;
  kinds: readonly string[];
  codec: FileCodec;
  /** The browser's workspace sink. */
  sink: FileSink;
  /** ISO run start. */
  now: string;
  /** The stable per-browser id (OPFS settings). */
  runDeviceId: string;
  /** Writers over the FILES repos (notes, papers, comments), built on the run's guarded sink. */
  writers?: (sink: FileSink) => readonly KindWriter[];
  /** True once a run in this browser verified (the completion marker). Read under the lock, before any request. */
  alreadyDone?: () => boolean;
};

/** The Web Locks name every tab of this origin asks for before it exports. */
export const WEB_UPGRADE_LOCK = "weaveforge-097-upgrade";

/** Thrown in a tab that asks for the upgrade while another tab of the same browser is running it. */
export class UpgradeInOtherTabError extends Error {
  override readonly name = "UpgradeInOtherTabError";
  constructor() {
    super("The upgrade is running in another tab. Let it finish there, then reload this tab.");
  }
}

/** Thrown in a tab that asks for the upgrade after another tab of the same browser finished it. */
export class UpgradeFinishedInOtherTabError extends Error {
  override readonly name = "UpgradeFinishedInOtherTabError";
  constructor() {
    super("The upgrade already finished in another tab. Reload this tab to use your files.");
  }
}

/** The part of `navigator.locks` the upgrade uses: a non-waiting request that calls back with null when held. */
export type UpgradeLocks = {
  request<T>(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => Promise<T>): Promise<T>;
};

function navigatorLocks(): UpgradeLocks | null {
  const locks = (globalThis as { navigator?: { locks?: UpgradeLocks } }).navigator?.locks;
  return locks && typeof locks.request === "function" ? locks : null;
}

/**
 * Web upgrade: exports the owner's PostgREST rows into the browser's sink. No KEYS mover is passed, so secrets
 * stay on the server and `reconnectProviders` names the services to reconnect (provider names only).
 *
 * The run holds the WEB_UPGRADE_LOCK Web Lock, so two tabs never export at once: a tab that finds it held
 * rejects with UpgradeInOtherTabError before any request or write. Without `navigator.locks` it runs unlocked.
 * A tab that gets the lock after another tab verified (`alreadyDone`) rejects with UpgradeFinishedInOtherTabError.
 */
export function runWebUpgrade(
  opts: WebUpgradeOptions,
  onProgress?: (e: ExportProgress) => void,
  locks: UpgradeLocks | null = navigatorLocks(),
): Promise<ExportResult> {
  const run = () =>
    opts.alreadyDone?.()
      ? Promise.reject(new UpgradeFinishedInOtherTabError())
      : runWebExport({
          kinds: opts.kinds,
          codec: opts.codec,
          source: new PostgrestSource(opts.server),
          sink: opts.sink,
          now: opts.now,
          runDeviceId: opts.runDeviceId,
          writers: opts.writers,
          onProgress,
        });
  if (!locks) return run();
  return locks.request(WEB_UPGRADE_LOCK, { ifAvailable: true }, (lock) =>
    lock ? run() : Promise.reject(new UpgradeInOtherTabError()),
  );
}
