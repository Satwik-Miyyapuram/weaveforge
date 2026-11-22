import {
  REPORT_PATH,
  type KindCount,
  type MigrationReport,
  type MigrationState,
  type MigrationTarget,
  type MissingRow,
  type RunReport,
} from "../domain/report";
import type { FileCodec, FileSink, Row, ServerSource } from "../domain/ports";
import type { KindWriter } from "../domain/kind-writer";
import { sha256Hex } from "../domain/hash";
import { sameRows, verifyExport, type Verdict } from "./verify-export";

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
  /** Writers over the FILES repos. A kind a writer owns is written and read back through it. */
  writers?: readonly KindWriter[];
  /** Desktop only: the backup runs before anything else, and a failure aborts the export. */
  desktop?: { folder: string; bridge: DesktopMigration };
  /** KEYS hook: runs only after a verified run, before the markers. A throw leaves the run incomplete. */
  moveSecrets?: () => Promise<void>;
  /** True when the source holds secrets: the run is refused unless a moveSecrets hook is given. */
  secretsPresent?: boolean;
  /** Web only: the stable per-browser id (OPFS settings). Desktop takes its id from the backup. */
  runDeviceId?: string;
};

export type ExportResult = { state: MigrationState; run: RunReport };

/** The desktop shell's part of the 0.9.7 contract: a pre-migration dump, then a mark. */
export type DesktopMigration = {
  backup(folder: string): Promise<{ deviceId: string; dump: string }>;
  markExported(folder: string): Promise<void>;
};

/**
 * Writes report.json via a .part file and rename, so a half-written report is never seen.
 * The runs of other devices already in report.json are kept; this device's entry is replaced.
 */
async function writeReport(sink: FileSink, report: MigrationReport): Promise<void> {
  let existing: RunReport[] = [];
  try {
    const parsed = JSON.parse(await sink.readText(REPORT_PATH)) as Partial<MigrationReport>;
    if (Array.isArray(parsed.runs)) existing = parsed.runs;
  } catch {
    existing = [];
  }
  const device = report.runs[0]?.deviceId;
  const kept = existing.filter((r) => r.deviceId !== device);
  const merged: MigrationReport = { ...report, runs: [...kept, ...report.runs] };
  const part = `${REPORT_PATH}.part`;
  await sink.write(part, JSON.stringify(merged, null, 2));
  await sink.rename(part, REPORT_PATH);
}

/** A refused run writes nothing but an incomplete report that carries the reason. */
async function refused(
  sink: FileSink,
  now: string,
  reason: string,
  target: MigrationTarget,
  extra: { backup?: string | null; deviceId?: string } = {},
): Promise<ExportResult> {
  const run: RunReport = {
    startedAt: now,
    finishedAt: now,
    sources: ["server"],
    kinds: {},
    blobs: { db: 0, verified: 0 },
    missing: [{ kind: "*", id: "*", reason }],
    deviceId: extra.deviceId,
  };
  await writeReport(sink, { version: 1, state: "incomplete", backup: extra.backup ?? null, deviceId: extra.deviceId, target, runs: [run] });
  return { state: "incomplete", run };
}

/**
 * Exports server rows and blobs into the sink, then runs the strict verify.
 * Sets the server marker only when verified, and always writes report.json
 * (via a .part file and rename, so a half-written report is never seen).
 * Never deletes or changes a server personal row.
 */
const TRASH_DIR = ".weaveforge/migration-0.9.7/trash";

/**
 * Trashed rows are never dropped. Each raw row is written as JSON and must read back to the
 * same JSON, or it is listed missing. Returns how many rows verified.
 */
async function exportTrash(kind: string, rows: Row[], sink: FileSink, missing: MissingRow[]): Promise<number> {
  let verified = 0;
  for (const row of rows) {
    const id = String(row.id);
    const path = `${TRASH_DIR}/${kind}/${encodeURIComponent(id)}.json`;
    const text = JSON.stringify(row);
    try {
      await sink.write(path, text);
    } catch {
      missing.push({ kind, id, reason: "trash write failed" });
      continue;
    }
    let back: string;
    try {
      back = JSON.stringify(JSON.parse(await sink.readText(path)));
    } catch {
      back = "";
    }
    if (back === text) verified++;
    else missing.push({ kind, id, reason: "trash read-back mismatch" });
  }
  return verified;
}

export async function runWebExport(opts: ExportOptions): Promise<ExportResult> {
  const { kinds, codec, source, sink, now, onProgress, desktop, writers = [], moveSecrets, secretsPresent, runDeviceId } = opts;
  const target: MigrationTarget = desktop ? "folder" : "opfs";
  const writerFor = (kind: string) => writers.find((w) => w.kinds.includes(kind));
  const dbCount: Record<string, number> = {};
  const backCount: Record<string, number> = {};
  const conflicts: Record<string, string[]> = {};
  const written: Record<string, number> = {};
  const missing: MissingRow[] = [];

  // A source that holds secrets cannot be exported without the KEYS mover that moves them.
  if (secretsPresent && !moveSecrets) {
    return refused(sink, now, "keys: no mover", target);
  }

  // The pre-migration dump comes first: nothing is read or written without it.
  let deviceId: string | undefined = desktop ? undefined : runDeviceId;
  let dumpName: string | null = null;
  if (desktop && typeof desktop.bridge?.backup !== "function") {
    return refused(sink, now, "desktop migrate097Backup missing: the shell cannot make the pre-migration dump", target);
  }
  if (desktop) {
    try {
      const made = await desktop.bridge.backup(desktop.folder);
      deviceId = made.deviceId;
      dumpName = made.dump;
    } catch (err) {
      return refused(sink, now, `backup failed: ${(err as Error).message}`, target);
    }
  }

  // Refuse before touching anything: unflushed writes would make the export stale.
  let pending: number;
  try {
    pending = await source.pendingOutbox();
  } catch (err) {
    const reason = `outbox unreadable: ${(err as Error).message}`;
    const run: RunReport = {
      startedAt: now,
      finishedAt: new Date().toISOString(),
      sources: ["server"],
      kinds: {},
      blobs: { db: 0, verified: 0 },
      missing: [{ kind: "outbox", id: "*", reason }],
      deviceId,
    };
    await writeReport(sink, { version: 1, state: "incomplete", backup: dumpName, deviceId, target, runs: [run] });
    return { state: "incomplete", run };
  }
  if (pending > 0) {
    return refused(sink, now, "outbox not empty: flush before export", target, { backup: dumpName, deviceId });
  }

  // Early report: if the run dies before the end, report.json already says incomplete.
  await writeReport(sink, {
    version: 1,
    state: "incomplete",
    backup: dumpName,
    deviceId,
    target,
    runs: [
      {
        startedAt: now,
        finishedAt: now,
        sources: ["server"],
        kinds: {},
        blobs: { db: 0, verified: 0 },
        missing: [{ kind: "*", id: "*", reason: "export in progress" }],
        deviceId,
      },
    ],
  });

  const trashCount: Record<string, number> = {};
  let current = "*";
  try {
    for (const kind of kinds) {
      current = kind;
      // One failing kind is listed missing; the later kinds still export.
      try {
        const rows = await source.listRows(kind);
        const raw = await source.countRows(kind);
        if (raw !== rows.length) missing.push({ kind, id: "*", reason: `raw count ${raw} != exported ${rows.length}` });
        const bad = await source.undecryptable(kind);
        if (bad > 0) missing.push({ kind, id: "*", reason: `${bad} content_enc row(s) failed to decrypt` });
        written[kind] = 0;
        dbCount[kind] = rows.length;
        trashCount[kind] = await exportTrash(kind, await source.listTrashed(kind), sink, missing);
        const writer = writerFor(kind);
        if (writer) {
          for (const row of rows) {
            try {
              await writer.write(kind, row);
              written[kind]++;
            } catch (err) {
              const reason = (err as Error).message;
              if (reason.startsWith("conflict:")) (conflicts[kind] ??= []).push(String(row.id));
              missing.push({ kind, id: String(row.id), reason });
            }
            onProgress?.({ kind, done: written[kind] ?? 0, total: rows.length });
          }
          const back = await writer.readBack(kind);
          backCount[kind] = back.length;
          if (!sameRows(kind, rows, back)) {
            missing.push({ kind, id: "*", reason: `readBack differs: ${back.length} read, ${rows.length} exported` });
          }
          continue;
        }
        // TODO(097-lanes): still raw codec + sink until their FILES repo lands: group (a) papers,
        // notes, relations, paperFields; and lists (readingLists). Keep this list in sync.
        if (!codec.supports(kind)) {
          for (const row of rows) missing.push({ kind, id: String(row.id), reason: "no wf-wasm codec" });
          continue;
        }
        for (const row of rows) {
          // One bad row is listed missing; the others are still exported.
          try {
            const file = codec.toFile(kind, row);
            await sink.write(file.path, file.text);
            written[kind]++;
          } catch (err) {
            missing.push({ kind, id: String(row.id), reason: (err as Error).message });
          }
          onProgress?.({ kind, done: written[kind] ?? 0, total: rows.length });
        }
      } catch {
        missing.push({ kind, id: "*", reason: `${kind}: read failed` });
      }
    }
    current = "blobs";
    const blobWriter = writerFor("blobs");
    for (const ref of await source.listBlobs()) {
      try {
        const bytes = await source.fetchBlob(ref);
        if (bytes.length !== ref.sizeBytes) {
          missing.push({ kind: "blobs", id: ref.path, reason: "size mismatch on fetch" });
          continue;
        }
        // The sha256 is computed here; the server never supplies one.
        const sha256 = await sha256Hex(bytes);
        const path = `assets/${ref.bucket}/${ref.path}`;
        if (blobWriter) {
          await blobWriter.write("blobs", { bucket: ref.bucket, path: ref.path, sha256, bytes });
        } else {
          await sink.write(path, bytes);
          await sink.write(`${path}.sha256`, sha256);
        }
        // Read back what was written; a blob that does not read back to the local sha256 is missing.
        const back = await sha256Hex(await sink.readBytes(path));
        const sidecar = (await sink.readText(`${path}.sha256`)).split("\n")[0];
        if (back !== sha256 || sidecar !== sha256) {
          missing.push({ kind: "blobs", id: ref.path, reason: "read-back sha256 mismatch" });
        }
      } catch (err) {
        missing.push({ kind: "blobs", id: ref.path, reason: (err as Error).message });
      }
    }
  } catch (err) {
    missing.push({ kind: current, id: "*", reason: (err as Error).message });
  }

  // Writer kinds are compared by readBack above; verify decodes the raw codec files only.
  const codecKinds = kinds.filter((k) => !writerFor(k));
  let verdict: Verdict;
  try {
    verdict = await verifyExport({ kinds: codecKinds, codec, source, sink });
  } catch (err) {
    verdict = { state: "incomplete", kinds: {}, blobs: { db: 0, verified: 0 }, errors: [] };
    missing.push({ kind: "verify", id: "*", reason: `verify failed: ${(err as Error).message}` });
  }
  for (const reason of verdict.errors) missing.push({ kind: "verify", id: "*", reason });

  const kindCounts: Record<string, KindCount> = {};
  for (const kind of kinds) {
    const isWriter = writerFor(kind) !== undefined;
    kindCounts[kind] = {
      db: isWriter ? (dbCount[kind] ?? 0) : (verdict.kinds[kind]?.db ?? 0),
      files: isWriter ? (backCount[kind] ?? 0) : (verdict.kinds[kind]?.files ?? 0),
      written: written[kind] ?? 0,
      conflicts: conflicts[kind] ?? [],
      trash: trashCount[kind] ?? 0,
    };
  }

  let state: MigrationState = missing.length === 0 && verdict.state === "verified" ? "verified" : "incomplete";
  const finishedAt = new Date().toISOString();
  const persist = async (): Promise<RunReport> => {
    const run: RunReport = {
      startedAt: now,
      finishedAt,
      sources: ["server"],
      kinds: kindCounts,
      blobs: { db: verdict.blobs.db, verified: verdict.blobs.verified },
      missing,
      deviceId,
    };
    const report: MigrationReport = {
      version: 1,
      state,
      backup: dumpName,
      verifiedAt: state === "verified" ? finishedAt : undefined,
      deviceId,
      target,
      runs: [run],
    };
    await writeReport(sink, report);
    return run;
  };

  // KEYS runs after verify and before any marker; a failure keeps the run incomplete.
  if (state === "verified" && moveSecrets) {
    try {
      await moveSecrets();
    } catch {
      state = "incomplete";
      // Fixed codes only: a thrown message can carry secret-like text, so it never reaches report.json.
      missing.push({ kind: "keys", id: "*", reason: "keys: move failed" });
    }
  }

  // Markers (0.9.7 contract): the server marker first, the desktop mark last. report.json says
  // incomplete ("markers pending") until both succeed, so a crash between the two is never verified.
  if (state === "verified") {
    state = "incomplete";
    missing.push({ kind: "marker", id: "*", reason: "markers pending" });
    const pendingAt = missing.length - 1;
    await persist();
    let marked = true;
    try {
      await source.markExported(now);
    } catch {
      marked = false;
      missing.push({ kind: "marker", id: "*", reason: "marker: server failed" });
    }
    if (marked && desktop) {
      try {
        await desktop.bridge.markExported(desktop.folder);
      } catch {
        marked = false;
        missing.push({ kind: "desktop", id: "*", reason: "marker: desktop failed" });
      }
    }
    missing.splice(pendingAt, 1);
    if (marked) state = "verified";
  }
  const run = await persist();
  return { state, run };
}

