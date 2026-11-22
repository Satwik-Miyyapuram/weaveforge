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

export type ExportProgress = { kind: string; done: number; total: number };

export type ExportOptions = {
  kinds: readonly string[];
  codec: FileCodec;
  source: ServerSource;
  sink: FileSink;
  /** ISO time: the run start, and the value written to profiles.exported_097_at when verified. */
  now: string;
  /** Called after each row is written to the sink. */
  onProgress?: (e: ExportProgress) => void;
};

export type ExportResult = { state: MigrationState; run: RunReport };

/**
 * Exports server rows and blobs into the sink, then runs the strict verify.
 * Sets the server marker only when verified, and always writes report.json
 * (via a .part file and rename, so a half-written report is never seen).
 * Never deletes or changes a server personal row.
 */
export async function runWebExport(opts: ExportOptions): Promise<ExportResult> {
  const { kinds, codec, source, sink, now, onProgress } = opts;
  const written: Record<string, number> = {};
  const missing: MissingRow[] = [];

  // Refuse before touching anything: unflushed writes would make the export stale.
  if ((await source.pendingOutbox()) > 0) {
    const run: RunReport = {
      startedAt: now,
      finishedAt: now,
      sources: ["server"],
      kinds: {},
      blobs: { db: 0, verified: 0 },
      missing: [{ kind: "*", id: "*", reason: "outbox not empty: flush before export" }],
    };
    return { state: "none", run };
  }

  let current = "*";
  try {
    for (const kind of kinds) {
      current = kind;
      const rows = await source.listRows(kind);
      const raw = await source.countRows(kind);
      if (raw !== rows.length) missing.push({ kind, id: "*", reason: `raw count ${raw} != exported ${rows.length}` });
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
        onProgress?.({ kind, done: written[kind] ?? 0, total: rows.length });
      }
    }
    current = "blobs";
    for (const ref of await source.listBlobs()) {
      const bytes = await source.fetchBlob(ref);
      if ((await sha256Hex(bytes)) !== ref.sha256) {
        missing.push({ kind: "blobs", id: ref.path, reason: "sha256 mismatch on fetch" });
        continue;
      }
      const path = `assets/${ref.bucket}/${ref.path}`;
      await sink.write(path, bytes);
      await sink.write(`${path}.sha256`, ref.sha256);
    }
  } catch (err) {
    missing.push({ kind: current, id: "*", reason: (err as Error).message });
  }

  const verdict = await verifyExport({ kinds, codec, source, sink });
  for (const reason of verdict.errors) missing.push({ kind: "verify", id: "*", reason });

  const kindCounts: Record<string, KindCount> = {};
  for (const kind of kinds) {
    kindCounts[kind] = {
      db: verdict.kinds[kind]?.db ?? 0,
      files: verdict.kinds[kind]?.files ?? 0,
      written: written[kind] ?? 0,
      conflicts: [],
    };
  }

  let state: MigrationState = missing.length === 0 && verdict.state === "verified" ? "verified" : "incomplete";
  if (state === "verified") {
    try {
      await source.markExported(now);
    } catch (err) {
      state = "incomplete";
      missing.push({ kind: "marker", id: "*", reason: `markExported: ${(err as Error).message}` });
    }
  }

  const finishedAt = new Date().toISOString();
  const run: RunReport = {
    startedAt: now,
    finishedAt,
    sources: ["server"],
    kinds: kindCounts,
    blobs: { db: verdict.blobs.db, verified: verdict.blobs.verified },
    missing,
  };
  const report: MigrationReport = {
    version: 1,
    state,
    backup: null,
    verifiedAt: state === "verified" ? finishedAt : undefined,
    runs: [run],
  };
  const part = `${REPORT_PATH}.part`;
  await sink.write(part, JSON.stringify(report, null, 2));
  await sink.rename(part, REPORT_PATH);
  return { state, run };
}
