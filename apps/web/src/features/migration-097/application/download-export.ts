import type { FileSink } from "../domain/ports";
import { zipFiles } from "../infrastructure/zip";

/**
 * "Download your data": zips whatever the sink holds, including an incomplete report.
 * Takes only the sink, so it cannot read the server or set profiles.exported_097_at,
 * and it never changes the write gate.
 */
export function buildDownloadZip(sink: FileSink): Promise<Uint8Array> {
  return zipFiles(sink);
}
