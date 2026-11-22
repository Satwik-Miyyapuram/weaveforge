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
};

/**
 * Web upgrade: exports the owner's PostgREST rows into the browser's sink. No KEYS mover is passed, so secrets
 * stay on the server and `reconnectProviders` names the services to reconnect (provider names only).
 */
export function runWebUpgrade(
  opts: WebUpgradeOptions,
  onProgress?: (e: ExportProgress) => void,
): Promise<ExportResult> {
  return runWebExport({
    kinds: opts.kinds,
    codec: opts.codec,
    source: new PostgrestSource(opts.server),
    sink: opts.sink,
    now: opts.now,
    runDeviceId: opts.runDeviceId,
    onProgress,
  });
}
