import { runWebExport, OUTBOX_NOT_EMPTY_REASON, type ExportOptions, type ExportResult } from "@/features/migration-097/application/run-web-export";
import type { FileCodec, FileSink } from "@/features/migration-097/domain/ports";
import type { KindWriter } from "@/features/migration-097/domain/kind-writer";
import { LocalPgSource } from "@/features/migration-097/infrastructure/local-pg-source";
import { MIGRATION_KINDS } from "@/features/migration-097/domain/report";
import { wasmFileCodec } from "@/features/migration-097/infrastructure/wasm-codec";
import { createMigrationWriters } from "@/features/migration-097/infrastructure/migration-writers";
import { workspaceFileSink } from "@/features/migration-097/infrastructure/workspace-file-sink";
import { sinkAsWorkspaceFs } from "@/features/migration-097/infrastructure/sink-workspace-fs";
import { FileProjectRepository } from "@/backend/providers/files/file-project-repo";
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
> &
  Partial<Pick<DesktopBridge, "queryLocalDb">>;

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
 * The CRDT kinds, their table, the column the editor's saver writes the note's text to, and its save time.
 * log_entries has no updated_at, so every log edit after creation is folded and compared.
 */
const TAIL_KINDS = [
  ["vault_page", "vault_pages", "body", "updated_at"],
  ["report_section", "report_sections", "notes", "updated_at"],
  ["log_entry", "log_entries", "body", "created_at"],
] as const;

/** One note with CRDT edits past its snapshot: its saved text, when it was saved, and its whole log. */
export type TailNote = { text: string | null; savedAt: string; lastEditAt: string; updates: readonly string[] };

/** A base64 log entry; older clients stored each update as JSON `{"$bytes": base64}` inside the bytea. */
function decodeUpdate(b64: string): Uint8Array {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes[0] !== 0x7b) return bytes;
  return decodeUpdate((JSON.parse(new TextDecoder().decode(bytes)) as { $bytes: string }).$bytes);
}

/**
 * How many notes hold CRDT edits their saved text lacks: the log is newer than the save and folds to other text.
 * A log older than the save is covered by it, since the saver writes the editor's whole text. A payload that
 * does not decode throws, so the run stops rather than drop an edit.
 */
export async function unsavedNotes(notes: readonly TailNote[]): Promise<number> {
  const Y = await import("yjs");
  let unsaved = 0;
  for (const note of notes) {
    if (Date.parse(note.lastEditAt) <= Date.parse(note.savedAt)) continue;
    const doc = new Y.Doc();
    for (const u of note.updates) Y.applyUpdate(doc, decodeUpdate(u));
    if (doc.store.pendingStructs) throw new Error("CRDT log has a gap");
    if (doc.getText("body").toString() !== (note.text ?? "")) unsaved++;
  }
  return unsaved;
}

/**
 * Unfolded CRDT edits past each snapshot. The export reads row text only, so a tail edit the text lacks would
 * be lost: it counts as pending and the run refuses. Without a query call each tail entry counts (fail closed).
 */
async function crdtTail(shell: DesktopExportShell): Promise<number> {
  if (!shell.migrate097Counts) throw new Error("migrate097Counts not wired");
  const { crdtTail: tail } = await shell.migrate097Counts();
  const total = Object.values(tail).reduce((sum, n) => sum + n, 0);
  if (total === 0 || !shell.queryLocalDb) return total;
  let unsaved = 0;
  for (const [kind, table, column, savedAt] of TAIL_KINDS) {
    const rows = (await shell.queryLocalDb(
      `select e.${column} as text, e.${savedAt} as saved_at,
              (select max(u.created_at) from crdt_updates u where u.resource_type = '${kind}' and u.resource_id = e.id) as last_edit_at,
              (select coalesce(json_agg(encode(u.payload, 'base64') order by u.id), '[]'::json)
                 from crdt_updates u where u.resource_type = '${kind}' and u.resource_id = e.id) as ups
         from ${table} e
        where exists (select 1 from crdt_updates u
                       where u.resource_type = '${kind}' and u.resource_id = e.id and u.id > coalesce(e.snapshot_upto, 0))`,
    )) as { text: string | null; saved_at: string; last_edit_at: string; ups: string[] }[];
    unsaved += await unsavedNotes(
      rows.map((r) => ({ text: r.text, savedAt: r.saved_at, lastEditAt: r.last_edit_at, updates: r.ups })),
    );
  }
  return unsaved;
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
    writeProject: () => writeProject(shell, folder, deps.sink, now),
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

/** Projects, the one holding the most rows first: files mode holds one project per workspace. */
const PROJECTS_SQL = `select p.id::text as id, p.name, p.color, p.created_at::text as created_at
  from projects p
 order by (select count(*) from log_entries t where t.project_id = p.id)
        + (select count(*) from report_sections t where t.project_id = p.id)
        + (select count(*) from reading_lists t where t.project_id = p.id) desc, p.created_at
 limit 1`;

/** Names the workspace's project after the database's main one, keeping its id, which settings are keyed by. */
async function writeProject(shell: DesktopExportShell, folder: string, sink: FileSink, now: string): Promise<void> {
  await assertOpenVault(shell, folder);
  type Row = { id: string; name: string; color: string | null; created_at: string };
  const [row] = shell.queryLocalDb ? ((await shell.queryLocalDb(PROJECTS_SQL)) as unknown as Row[]) : [];
  const folderName = folder.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace";
  await new FileProjectRepository(sinkAsWorkspaceFs(sink)).adopt(
    row
      ? { id: row.id, name: row.name, ...(row.color ? { color: row.color } : {}), createdAt: new Date(row.created_at).toISOString() }
      : { id: crypto.randomUUID(), name: folderName, createdAt: now },
  );
}
