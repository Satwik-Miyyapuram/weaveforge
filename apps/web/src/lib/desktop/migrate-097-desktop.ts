import { runWebExport, OUTBOX_NOT_EMPTY_REASON, type ExportOptions, type ExportResult } from "@/features/migration-097/application/run-web-export";
import type { FileCodec, FileSink } from "@/features/migration-097/domain/ports";
import type { KindWriter } from "@/features/migration-097/domain/kind-writer";
import { LocalPgSource } from "@/features/migration-097/infrastructure/local-pg-source";
import { MIGRATION_KINDS } from "@/features/migration-097/domain/report";
import { wasmFileCodec } from "@/features/migration-097/infrastructure/wasm-codec";
import { createMigrationWriters } from "@/features/migration-097/infrastructure/migration-writers";
import { workspaceFileSink } from "@/features/migration-097/infrastructure/workspace-file-sink";
import { DesktopWorkspaceFs } from "@/features/workspace/infrastructure/parts";
import { loadCore } from "@/lib/rust-core";
import { warnOnce } from "@/lib/error-report/parts";
import type { DesktopBridge } from "./desktop-bridge";
import { desktopMigrationFromBridge } from "./desktop-migration";
import type { ExportReply, ExportRunner } from "./migrate-097-upgrade";

/** The shell calls the desktop export uses. All optional on the bridge; a missing one refuses the run. */
export type DesktopExportShell = Pick<
  DesktopBridge,
  | "vaultRoot"
  | "migrate097MoveSecrets"
  | "readLocalFile"
  | "migrate097Backup"
  | "migrate097Read"
  | "migrate097MarkExported"
  | "migrate097Counts"
>;

/**
 * The sink writes into the open vault and the shell marks `folder`, so they must be the same folder. Checked
 * before the run and again before the secrets move and the mark, in case another folder was opened meanwhile.
 */
async function assertOpenVault(shell: DesktopExportShell, folder: string): Promise<void> {
  const open = await shell.vaultRoot();
  if (!open || !sameFolder(open.path, folder)) throw new Error("the open workspace is not the folder being upgraded");
}

/**
 * Whether two paths name the same folder: `\` and `/` match, trailing separators drop, and a Windows path (one
 * with a drive letter, or a UNC path) compares without case, as Windows does. A verbatim path (`\\?\C:\x`,
 * `\\?\UNC\host\share`) matches its plain form. POSIX paths stay case-sensitive.
 */
export function sameFolder(a: string, b: string): boolean {
  const norm = (p: string) => {
    const plain = p.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
    const slashed = plain.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^([a-zA-Z]:|\/\/)/.test(slashed) ? slashed.toLowerCase() : slashed;
  };
  return norm(a) === norm(b);
}

/** What the run writes with: the codec, the vault sink and the kinds. Loaded once per run. */
export type DesktopExportDeps = {
  codec: FileCodec;
  sink: FileSink;
  kinds: readonly string[];
  writers?: (sink: FileSink) => readonly KindWriter[];
};

/**
 * Unfolded CRDT edits past each snapshot. The export reads rows only and production never folds the tail, so
 * any tail would be lost: it counts as pending, and the run refuses until the app has compacted it.
 */
async function crdtTail(shell: DesktopExportShell): Promise<number> {
  if (!shell.migrate097Counts) throw new Error("migrate097Counts not wired");
  const { crdtTail: tail } = await shell.migrate097Counts();
  return Object.values(tail).reduce((sum, n) => sum + n, 0);
}

/**
 * Export options for the old local database: the shell backs it up, LocalPgSource reads it read-only, the
 * engine verifies the files, and only then do the secrets move and the shell mark the folder exported.
 */
export function desktopExportOptions(
  shell: DesktopExportShell,
  folder: string,
  deps: DesktopExportDeps,
  now: string,
  onProgress?: ExportOptions["onProgress"],
): ExportOptions {
  const read = shell.migrate097Read;
  if (!read) throw new Error("migrate097Read not wired");
  const source = new LocalPgSource({
    read: (kind, after, limit) => read(kind, after, limit),
    pendingOutbox: () => crdtTail(shell),
    // Secrets move after verify (moveSecrets below); none stay behind on a server to reconnect.
    secretProviders: async () => [],
    fetchBlob: async (ref) => {
      if (!shell.readLocalFile) throw new Error("readLocalFile not wired");
      const bytes = await shell.readLocalFile(ref.bucket, ref.path);
      if (!bytes) throw new Error("blob not on disk");
      return bytes;
    },
    // The local database is read-only here; the shell's mark_exported_097 is the marker.
    markExported097: async () => {},
  });
  const migration = desktopMigrationFromBridge(shell);
  return {
    kinds: deps.kinds,
    codec: deps.codec,
    source,
    sink: deps.sink,
    now,
    onProgress,
    writers: deps.writers,
    desktop: {
      folder,
      bridge: {
        backup: (f) => migration.backup(f),
        markExported: async (f) => {
          await assertOpenVault(shell, f);
          await migration.markExported(f);
        },
      },
    },
    moveSecrets: async () => {
      await assertOpenVault(shell, folder);
      await shell.migrate097MoveSecrets();
    },
  };
}

function toReply(result: ExportResult): ExportReply {
  return {
    state: result.state,
    reconnectProviders: result.reconnectProviders,
    undecryptable: result.undecryptable,
    pendingSync: result.run.missing?.some((m) => m.reason === OUTBOX_NOT_EMPTY_REASON) ?? false,
    archivedOnly: result.archivedOnly,
  };
}

/** The app's deps: the wasm codec, and a sink over the open vault (the folder the gate upgrades). */
export function desktopDeps(shell: DesktopBridge): () => Promise<DesktopExportDeps> {
  return async () => {
    const codec = wasmFileCodec(await loadCore(), "");
    return {
      codec,
      sink: workspaceFileSink(new DesktopWorkspaceFs(shell)),
      kinds: MIGRATION_KINDS,
      // As on the web: kinds without a codec are archived losslessly and written to their file home.
      writers: (sink) => createMigrationWriters(sink, codec, (kind, _row, err) =>
        warnOnce("migrate-097-desktop", `a ${kind} row stayed in the archive only`, err),
      ),
    };
  };
}

/** The desktop upgrade screen's runner. A throw (no read call, deps failed to load) ends the screen "stopped". */
export function makeDesktopRunner(
  shell: DesktopExportShell,
  loadDeps: () => Promise<DesktopExportDeps>,
  run: (opts: ExportOptions) => Promise<ExportResult> = runWebExport,
  clock: () => string = () => new Date().toISOString(),
): ExportRunner {
  return async (folder, onProgress) => {
    if (!shell.migrate097Read) throw new Error("migrate097Read not wired");
    await assertOpenVault(shell, folder);
    const deps = await loadDeps();
    return toReply(await run(desktopExportOptions(shell, folder, deps, clock(), onProgress)));
  };
}
