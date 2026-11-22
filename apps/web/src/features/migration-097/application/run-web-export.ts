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
import { PAPER_FIELD_KINDS, projectDefsMismatches } from "../domain/paper-fields-file";
import { sanitizeBlobRefs } from "../domain/asset-path";
import { createPaperFieldsWriter } from "../infrastructure/kind-writer-paper-fields";
import { sameRows, verifyExport, type Verdict } from "./verify-export";
import { createFileStore, type FileStore, type Outputs } from "./file-store";

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
  /** Project id to folder ("" = workspace root). Given, the run writes paper fields through the FILES repos itself. */
  projectFolders?: ReadonlyMap<string, string>;
  /** Desktop only: the backup runs before anything else, and a failure aborts the export. */
  desktop?: { folder: string; bridge: DesktopMigration };
  /** KEYS hook: runs only after a verified run, before the markers. A throw leaves the run incomplete. */
  moveSecrets?: () => Promise<void>;
  /** True when the source holds secrets: the run is refused unless a moveSecrets hook is given. */
  secretsPresent?: boolean;
  /** Web only: the stable per-browser id (OPFS settings). Desktop takes its id from the backup. */
  runDeviceId?: string;
  /** Receives the raw error text of each failure. It never reaches report.json, which carries fixed codes only. */
  debugLog?: (line: string) => void;
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
 * Trashed rows are never dropped. An encrypted row is written as its codec decode (the live path);
 * any other row is written as raw JSON. Each file must read back to the text written, or the row is
 * listed missing. Returns how many rows verified.
 */
async function exportTrash(kind: string, rows: Row[], sink: FileSink, store: FileStore, codec: FileCodec, missing: MissingRow[]): Promise<number> {
  let verified = 0;
  for (const row of rows) {
    if (row.id === undefined || row.id === null || row.id === "") {
      missing.push({ kind, id: "*", reason: "missing id" });
      continue;
    }
    const id = String(row.id);
    const path = `${TRASH_DIR}/${kind}/${encodeURIComponent(id)}.json`;
    let text: string;
    try {
      // Encrypted rows go through the same codec decode as live rows; plain rows stay raw JSON.
      text = row.contentEnc !== undefined && codec.supports(kind) ? codec.toFile(kind, row).text : JSON.stringify(row);
    } catch {
      missing.push({ kind, id, reason: "trash decode failed" });
      continue;
    }
    let written: string;
    try {
      written = await store.store(path, text, await sha256Hex(text));
    } catch {
      missing.push({ kind, id, reason: "trash write failed" });
      continue;
    }
    let back: string;
    try {
      back = await sink.readText(written);
    } catch {
      back = "";
    }
    if (back === text) verified++;
    else missing.push({ kind, id, reason: "trash read-back mismatch" });
  }
  return verified;
}

/**
 * Project folders must be unique (ignoring case: the desktop filesystem does) and no folder may sit inside
 * another. The root ("") may sit beside any folder, as the root's papers stay in the root.
 */
export function checkProjectFolders(folders: ReadonlyMap<string, string>): void {
  const seen: string[] = [];
  for (const raw of folders.values()) {
    const folder = raw.toLowerCase();
    for (const other of seen) {
      const nested = folder !== "" && other !== "" && (folder.startsWith(`${other}/`) || other.startsWith(`${folder}/`));
      if (folder === other || nested) throw new Error("project folders must be unique and not nested");
    }
    seen.push(folder);
  }
}

/**
 * A verify error (verify-export.ts) as a fixed report code. The raw text names a blob path or a kind, and
 * report.json must not carry those, so only the failure kind is kept.
 */
export function verifyReasonCode(raw: string): string {
  if (raw.endsWith(": unsafe path")) return "blob-unsafe-path";
  if (raw.endsWith(": size mismatch")) return "blob-size-mismatch";
  if (raw.endsWith(": sha256 mismatch")) return "blob-sha256-mismatch";
  if (raw.endsWith(": read failed") || raw === "blobs: read failed") return "read-failed";
  if (raw.includes("decoded files differ")) return "decoded-differ";
  return "verify-error";
}

/**
 * This device's own previous run's outputs (path to sha256). Other devices' runs are never read here, so
 * their files are never overwritten or listed as this device's orphans. Empty when there is no such run.
 */
async function priorOutputs(sink: FileSink, deviceId: string | undefined): Promise<Outputs> {
  let parsed: Partial<MigrationReport>;
  try {
    parsed = JSON.parse(await sink.readText(REPORT_PATH)) as Partial<MigrationReport>;
  } catch {
    return {};
  }
  const own = (Array.isArray(parsed.runs) ? parsed.runs : []).filter((r) => deviceId !== undefined && r.deviceId === deviceId);
  const latest = own.reduce<RunReport | undefined>((best, r) => (!best || r.startedAt > best.startedAt ? r : best), undefined);
  return latest?.outputs ?? {};
}

export async function runWebExport(opts: ExportOptions): Promise<ExportResult> {
  const { kinds, codec, source, sink, now, onProgress, desktop, writers: givenWriters = [], projectFolders, moveSecrets, secretsPresent, runDeviceId, debugLog } = opts;
  if (projectFolders) checkProjectFolders(projectFolders);
  const writers = projectFolders ? [...givenWriters, createPaperFieldsWriter(sink, projectFolders)] : givenWriters;
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
  // Web always has a device id: the caller's stable one, or a fresh one so the run still counts per device.
  let deviceId: string | undefined = desktop ? undefined : (runDeviceId ?? globalThis.crypto.randomUUID());
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
      // The raw message can name a path: it goes to the debug log only, never to report.json.
      debugLog?.(`backup failed: ${(err as Error).message}`);
      return refused(sink, now, "backup-failed", target);
    }
  }

  // Refuse before touching anything: unflushed writes would make the export stale.
  let pending: number;
  try {
    pending = await source.pendingOutbox();
  } catch (err) {
    debugLog?.(`outbox unreadable: ${(err as Error).message}`);
    const reason = "outbox-unreadable";
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

  // Read before the early report, which replaces this device's run and with it its outputs.
  const prior = await priorOutputs(sink, deviceId);
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

  const store = await createFileStore(sink, prior);
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
        trashCount[kind] = await exportTrash(kind, await source.listTrashed(kind), sink, store, codec, missing);
        const writer = writerFor(kind);
        if (writer) {
          for (const row of rows) {
            try {
              await writer.write(kind, row);
              written[kind]++;
            } catch (err) {
              const message = (err as Error).message;
              debugLog?.(`write ${kind} ${String(row.id)}: ${message}`);
              const conflict = message.startsWith("conflict:");
              if (conflict) (conflicts[kind] ??= []).push(String(row.id));
              missing.push({ kind, id: String(row.id), reason: conflict ? `conflict:${kind}` : `write-failed:${kind}` });
            }
            onProgress?.({ kind, done: written[kind] ?? 0, total: rows.length });
          }
          const back = await writer.readBack(kind);
          backCount[kind] = back.length;
          if (kind === "paperFields") {
            // Defs are compared per project, so a project that did not survive is named by its id.
            missing.push(...projectDefsMismatches(rows, back));
          } else if (!sameRows(kind, rows, back)) {
            missing.push({ kind, id: "*", reason: "readback-differs" });
          }
          continue;
        }
        // TODO(097-lanes): still raw codec + sink until their FILES repo lands: group (a) papers,
        // notes, relations; and lists (readingLists). Keep this list in sync.
        if (!codec.supports(kind)) {
          // A paper-field kind with no writer is not a codec gap: name the real cause.
          const reason = (PAPER_FIELD_KINDS as readonly string[]).includes(kind)
            ? "paper fields writer not wired"
            : "no wf-wasm codec";
          for (const row of rows) missing.push({ kind, id: String(row.id), reason });
          continue;
        }
        for (const row of rows) {
          // One bad row is listed missing; the others are still exported.
          try {
            const file = codec.toFile(kind, row);
            await store.store(file.path, file.text, await sha256Hex(file.text));
            written[kind]++;
          } catch (err) {
            debugLog?.(`codec ${kind} ${String(row.id)}: ${(err as Error).message}`);
            missing.push({ kind, id: String(row.id), reason: `codec-failed:${kind}` });
          }
          onProgress?.({ kind, done: written[kind] ?? 0, total: rows.length });
        }
      } catch {
        missing.push({ kind, id: "*", reason: `${kind}: read failed` });
      }
    }
    current = "blobs";
    const blobWriter = writerFor("blobs");
    for (const item of sanitizeBlobRefs(await source.listBlobs())) {
      const { ref } = item;
      // The id keeps the bucket: the same path in two buckets must read apart in the report.
      const id = `${ref.bucket}/${ref.path}`;
      if (item.unsafe) {
        missing.push({ kind: "blobs", id, reason: "unsafe path" });
        continue;
      }
      try {
        const bytes = await source.fetchBlob(ref);
        if (bytes.length !== ref.sizeBytes) {
          missing.push({ kind: "blobs", id, reason: "size mismatch on fetch" });
          continue;
        }
        // The sha256 is computed here; the server never supplies one.
        const sha256 = await sha256Hex(bytes);
        let path = `assets/${item.bucket}/${item.path}`;
        if (blobWriter) {
          await blobWriter.write("blobs", { bucket: item.bucket, path: item.path, sha256, bytes });
        } else {
          // A differing file at the path keeps its bytes: the DB blob lands at a conflict copy instead.
          path = await store.store(path, bytes, sha256);
          await store.writeIfMissing(`${path}.sha256`, sha256);
        }
        // Read back what was written; a blob that does not read back to the local sha256 is missing.
        const back = await sha256Hex(await sink.readBytes(path));
        const sidecar = (await sink.readText(`${path}.sha256`)).split("\n")[0];
        if (back !== sha256 || sidecar !== sha256) {
          missing.push({ kind: "blobs", id, reason: "read-back sha256 mismatch" });
        }
      } catch (err) {
        debugLog?.(`blob ${ref.path}: ${(err as Error).message}`);
        missing.push({ kind: "blobs", id, reason: "blob-failed" });
      }
    }
  } catch (err) {
    debugLog?.(`run ${current}: ${(err as Error).message}`);
    missing.push({ kind: current, id: "*", reason: `run-failed:${current}` });
  }

  // Orphans: what this device's previous run wrote and this run did not. They stay on disk untouched and do
  // not block verify. They stay in outputs, so later runs still see them as this device's files.
  const kept = Object.entries(prior).filter(([path]) => store.outputs[path] === undefined);
  const orphans = kept.map(([path]) => path);
  const outputs: Outputs = { ...Object.fromEntries(kept), ...store.outputs };

  // Writer kinds are compared by readBack above; verify decodes the raw codec files only.
  const codecKinds = kinds.filter((k) => !writerFor(k));
  let verdict: Verdict;
  try {
    verdict = await verifyExport({ kinds: codecKinds, codec, source, sink, ignore: new Set(orphans) });
  } catch (err) {
    verdict = { state: "incomplete", kinds: {}, blobs: { db: 0, verified: 0 }, errors: [] };
    debugLog?.(`verify: ${(err as Error).message}`);
    missing.push({ kind: "verify", id: "*", reason: "verify-failed" });
  }
  for (const raw of verdict.errors) missing.push({ kind: "verify", id: "*", reason: verifyReasonCode(raw) });

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
      conflicts: store.conflicts,
      orphans: orphans.length > 0 ? orphans : undefined,
      outputs,
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
      await source.markExported097();
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

