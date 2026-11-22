import {
  REPORT_PATH,
  type KindCount,
  type MigrationReport,
  type MigrationState,
  type MissingRow,
  type RunReport,
} from "../domain/report";
import type { FileCodec, FileSink, ServerSource } from "../domain/ports";
import { sha256Hex } from "../domain/hash";
import { verifyExport } from "./verify-export";

export type ExportOptions = {
  kinds: readonly string[];
  codec: FileCodec;
  source: ServerSource;
  sink: FileSink;
  /** ISO time: the run start, and the value written to profiles.exported_097_at when verified. */
  now: string;
};

export type ExportResult = { state: MigrationState; run: RunReport };

/**
 * Exports server rows and blobs into the sink, then runs the strict verify.
 * Sets the server marker only when verified, and always writes report.json.
 * Never deletes or changes a server personal row.
 */
export async function runWebExport(opts: ExportOptions): Promise<ExportResult> {
  const { kinds, codec, source, sink, now } = opts;
  const errors: string[] = [];
  const written: Record<string, number> = {};
  const missing: MissingRow[] = [];

  // Refuse before touching anything: unflushed writes would make the export stale.
  if ((await source.pendingOutbox()) > 0) {
    return {
      state: "none",
      run: { startedAt: now, finishedAt: now, sources: ["server"], kinds: {}, blobs: { db: 0, verified: 0 }, missing: [], errors: ["outbox not empty: flush before export"] },
    };
  }

  try {
    for (const kind of kinds) {
      const rows = await source.listRows(kind);
      const raw = await source.countRows(kind);
      if (raw !== rows.length) errors.push(`${kind}: raw count ${raw} != exported ${rows.length}`);
      const bad = await source.undecryptable(kind);
      if (bad > 0) missing.push({ kind, id: "*", reason: `${bad} content_enc row(s) failed to decrypt` });
      written[kind] = 0;
      if (!codec.supports(kind)) {
        for (const row of rows) missing.push({ kind, id: String(row.id), reason: "no wf-wasm codec" });
        continue;
      }
      for (const row of rows) {
        const file = codec.toFile(kind, row);
        await sink.write(file.path, file.text);
        written[kind]++;
      }
    }
    for (const ref of await source.listBlobs()) {
      const bytes = await source.fetchBlob(ref);
      if ((await sha256Hex(bytes)) !== ref.sha256) {
        errors.push(`blob ${ref.bucket}/${ref.path}: sha256 mismatch on fetch`);
        continue;
      }
      const path = `assets/${ref.bucket}/${ref.path}`;
      await sink.write(path, bytes);
      await sink.write(`${path}.sha256`, ref.sha256);
    }
  } catch (err) {
    errors.push((err as Error).message);
  }

  const verdict = await verifyExport({ kinds, codec, source, sink });
  errors.push(...verdict.errors);

  const kindCounts: Record<string, KindCount> = {};
  for (const kind of kinds) {
    kindCounts[kind] = {
      db: verdict.kinds[kind]?.db ?? 0,
      files: verdict.kinds[kind]?.files ?? 0,
      written: written[kind] ?? 0,
      conflicts: [],
    };
  }

  let state: MigrationState =
    errors.length === 0 && missing.length === 0 && verdict.state === "verified" ? "verified" : "incomplete";
  if (state === "verified") {
    try {
      await source.markExported(now);
    } catch (err) {
      state = "incomplete";
      errors.push(`markExported: ${(err as Error).message}`);
    }
  }

  const run: RunReport = {
    startedAt: now,
    finishedAt: new Date().toISOString(),
    sources: ["server"],
    kinds: kindCounts,
    blobs: { db: verdict.blobs.db, verified: verdict.blobs.verified },
    missing,
    errors,
  };
  const report: MigrationReport = { version: 1, state, backup: null, runs: [run] };
  await sink.write(REPORT_PATH, JSON.stringify(report, null, 2));
  return { state, run };
}
