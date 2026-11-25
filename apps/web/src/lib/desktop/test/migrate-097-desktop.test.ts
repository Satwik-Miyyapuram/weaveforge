import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySink } from "@/features/migration-097/infrastructure/memory-sink";
import { OUTBOX_NOT_EMPTY_REASON, type ExportResult } from "@/features/migration-097/application/run-web-export";
import { MIGRATION_KINDS } from "@/features/migration-097/domain/report";
import { FIXTURE, KINDS, SUPPORTED, fakeCodec } from "@/features/migration-097/test/web-export/helpers";
import { onlyReportPath } from "@/features/migration-097/test/own-report";
import type { DesktopBridge } from "../desktop-bridge";
import * as Y from "yjs";
import { sinkAsWorkspaceFs } from "@/features/migration-097/infrastructure/sink-workspace-fs";
import { desktopDeps, exportedProjects, makeDesktopRunner, sameFolder, unsavedNotes, type DesktopExportShell, type ExportedProject } from "../migrate-097-desktop";

const NOW = "2026-11-23T00:00:00.000Z";
const FOLDER = "C:/ws";

type ShellOpts = {
  tail?: number;
  noCounts?: boolean;
  noRead?: boolean;
  noBackup?: boolean;
  markFails?: boolean;
  /** The open vault; defaults to FOLDER. */
  vault?: string | null;
  /** The open vault once the backup has run (another folder opened mid-run). */
  vaultAfterBackup?: string;
  /** The notes the tail query returns; with this set the shell has queryLocalDb. */
  tailNotes?: TailRow[];
};

type TailRow = { saved_at: string; last_edit_at: string; text: string | null; ups: string[] };

/** A Yjs log that types `text` into the "body" text, as base64 updates; `wrapped` stores each as {"$bytes": …}. */
function logOf(text: string, wrapped = false): string[] {
  const doc = new Y.Doc();
  const ups: string[] = [];
  doc.on("update", (u: Uint8Array) => {
    const b64 = Buffer.from(u).toString("base64");
    ups.push(wrapped ? Buffer.from(JSON.stringify({ $bytes: b64 })).toString("base64") : b64);
  });
  for (const ch of text) doc.getText("body").insert(doc.getText("body").length, ch);
  return ups;
}

const SAVED = "2026-11-19T20:07:24.000Z";
const LATER = "2026-11-23T14:07:50.000Z";

/**
 * A shell over FIXTURE, in snake_case like the local table. Each call is logged in order. The mark refuses as
 * the shell's check_own_run_verdict does: this device's run in report.json must say verified.
 */
function fakeShell(sink: MemorySink, opts: ShellOpts = {}) {
  const calls: string[] = [];
  let vault = opts.vault === undefined ? FOLDER : opts.vault;
  const shell: DesktopExportShell = {
    vaultRoot: async () => (vault === null ? null : { path: vault, state: "existing" }),
    migrate097MoveSecrets: async () => {
      calls.push("move-secrets");
      return [];
    },
    readLocalFile: async () => null,
    migrate097Backup: opts.noBackup
      ? undefined
      : async () => {
          calls.push("backup");
          if (opts.vaultAfterBackup) vault = opts.vaultAfterBackup;
          return { deviceId: "dev-42", dumpPath: "C:\\app\\local-db-backups\\pre-migration-097.dump" };
        },
    migrate097Read: opts.noRead
      ? undefined
      : async (kind, after) => {
          calls.push(`read:${kind}`);
          return after === null ? ((FIXTURE[kind] ?? []) as Record<string, unknown>[]) : [];
        },
    migrate097MarkExported: async (folder) => {
      calls.push(`mark:${folder}`);
      if (opts.markFails) throw new Error("shell refused");
      const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as {
        backup?: string;
        runs: { deviceId?: string; state: string }[];
      };
      const own = report.runs.filter((r) => r.deviceId === "dev-42").at(-1);
      if (own?.state !== "verified") throw new Error("refused: this device's verify run did not finish");
      if (report.backup?.includes("\\") || report.backup?.includes("/")) throw new Error("refused: backup name");
    },
    migrate097Counts: opts.noCounts
      ? undefined
      : async () => ({ counts: {}, crdtTail: { vault_pages: opts.tail ?? 0, log_entries: 0 } }),
    queryLocalDb: opts.tailNotes
      ? async (sql) => {
          calls.push("query");
          return sql.includes("'vault_page'") ? opts.tailNotes! : [];
        }
      : undefined,
  };
  return { shell, calls };
}

const deps = (sink: MemorySink, projects?: readonly ExportedProject[]) => async () => ({
  codec: fakeCodec(SUPPORTED),
  sink,
  kinds: KINDS,
  projects,
});

function setup(opts: ShellOpts = {}, projects?: readonly ExportedProject[]) {
  const sink = new MemorySink();
  const { shell, calls } = fakeShell(sink, opts);
  return { sink, shell, calls, runner: makeDesktopRunner(shell, deps(sink, projects), undefined, () => NOW) };
}

test("desktop runner: backup, then reads, then secrets, then mark; the shell sees a verified run and ends verified", async () => {
  const { calls, runner } = setup();
  const reply = await runner(FOLDER, () => {});
  assert.equal(reply.state, "verified");
  assert.equal(calls[0], "backup");
  const firstRead = calls.findIndex((c) => c.startsWith("read:"));
  assert.ok(firstRead > 0);
  assert.ok(calls.indexOf("move-secrets") > firstRead);
  assert.equal(calls.at(-1), `mark:${FOLDER}`);
  assert.equal(reply.pendingSync, false);
  // FIXTURE carries no content_enc, so nothing counts as undecryptable; no provider needs reconnecting.
  assert.equal(reply.undecryptable ?? 0, 0);
  assert.deepEqual(reply.reconnectProviders ?? [], []);
});

test("desktop runner: report.json names the backup by file name only", async () => {
  const { sink, runner } = setup();
  await runner(FOLDER, () => {});
  const report = JSON.parse(await sink.readText(await onlyReportPath(sink))) as { backup?: string };
  assert.equal(report.backup, "pre-migration-097.dump");
});

test("desktop runner: a local row that still carries content_enc is listed missing, so nothing is marked", async () => {
  const sink = new MemorySink();
  const { shell, calls } = fakeShell(sink);
  const read = shell.migrate097Read!;
  shell.migrate097Read = async (kind, after, limit) => {
    const rows = await read(kind, after, limit);
    return kind === "experiments" && after === null ? rows.map((r, i) => (i === 0 ? { ...r, content_enc: "c" } : r)) : rows;
  };
  const reply = await makeDesktopRunner(shell, deps(sink), undefined, () => NOW)(FOLDER, () => {});
  assert.notEqual(reply.state, "verified");
  assert.equal(reply.undecryptable, 1);
  assert.ok(!calls.some((c) => c.startsWith("mark:")));
});

test("desktop runner: an unfolded CRDT tail refuses as pending sync, with no mark and no secret move", async () => {
  const { calls, runner } = setup({ tail: 3 });
  const reply = await runner(FOLDER, () => {});
  assert.notEqual(reply.state, "verified");
  assert.equal(reply.pendingSync, true);
  assert.ok(!calls.some((c) => c.startsWith("mark:")));
  assert.ok(!calls.includes("move-secrets"));
});

test("desktop runner: a tail whose edits are all in the saved text does not block the export", async () => {
  const { calls, runner } = setup({
    tail: 3,
    tailNotes: [
      // Log newer than the save, same text: the body saver already wrote it.
      { saved_at: SAVED, last_edit_at: LATER, text: "hello", ups: logOf("hello") },
      // Log older than the save, different text: the row was edited after.
      { saved_at: LATER, last_edit_at: SAVED, text: "hello world", ups: logOf("hello", true) },
    ],
  });
  const reply = await runner(FOLDER, () => {});
  assert.equal(reply.state, "verified");
  assert.equal(reply.pendingSync, false);
  assert.ok(calls.includes("query"));
});

test("desktop runner: the tail query reads each table's save time; log_entries has no updated_at", async () => {
  const sink = new MemorySink();
  const { shell } = fakeShell(sink, { tail: 1, tailNotes: [] });
  const sqls: string[] = [];
  const query = shell.queryLocalDb!;
  shell.queryLocalDb = async (sql, params) => (sqls.push(sql), query(sql, params));
  await makeDesktopRunner(shell, deps(sink), undefined, () => NOW)(FOLDER, () => {});
  const of = (table: string) => sqls.find((s) => s.includes(`from ${table} e`)) ?? "";
  assert.match(of("vault_pages"), /e\.updated_at as saved_at/);
  assert.match(of("report_sections"), /e\.notes as text, e\.updated_at as saved_at/);
  assert.match(of("log_entries"), /e\.created_at as saved_at/);
  assert.doesNotMatch(of("log_entries"), /updated_at/);
});

test("desktop runner: a tail newer than the save with different text refuses as pending sync", async () => {
  const { calls, runner } = setup({
    tail: 1,
    tailNotes: [{ saved_at: SAVED, last_edit_at: LATER, text: "hell", ups: logOf("hello") }],
  });
  const reply = await runner(FOLDER, () => {});
  assert.notEqual(reply.state, "verified");
  assert.equal(reply.pendingSync, true);
  assert.ok(!calls.some((c) => c.startsWith("mark:")));
});

test("desktop runner: an undecodable tail payload refuses (outbox unreadable)", async () => {
  const { calls, runner } = setup({
    tail: 1,
    tailNotes: [{ saved_at: SAVED, last_edit_at: LATER, text: "x", ups: ["AAAA"] }],
  });
  const reply = await runner(FOLDER, () => {});
  assert.notEqual(reply.state, "verified");
  assert.ok(!calls.some((c) => c.startsWith("mark:")));
});

test("unsavedNotes: equal text, older log or newer differing log", async () => {
  const at = (saved: string, edit: string, text: string | null, ups: string[]) => ({ savedAt: saved, lastEditAt: edit, text, updates: ups });
  assert.equal(await unsavedNotes([at(SAVED, LATER, "ab", logOf("ab"))]), 0);
  assert.equal(await unsavedNotes([at(LATER, SAVED, "zz", logOf("ab"))]), 0);
  assert.equal(await unsavedNotes([at(SAVED, LATER, "a", logOf("ab"))]), 1);
  // A null row text is the empty note.
  assert.equal(await unsavedNotes([at(SAVED, LATER, null, logOf(""))]), 0);
});

test("desktop runner: no counts call refuses (outbox unreadable), with no mark", async () => {
  const sink = new MemorySink();
  const { shell, calls } = fakeShell(sink, { noCounts: true });
  let reason = "";
  const reply = await makeDesktopRunner(shell, deps(sink), async (opts) => {
    const { runWebExport } = await import("@/features/migration-097/application/run-web-export");
    const result = await runWebExport(opts);
    reason = result.run.missing?.map((m) => m.reason).join(",") ?? "";
    return result;
  }, () => NOW)(FOLDER, () => {});
  assert.notEqual(reply.state, "verified");
  assert.ok(reason.includes("outbox-unreadable"), reason);
  assert.ok(!reason.includes(OUTBOX_NOT_EMPTY_REASON));
  assert.ok(!calls.some((c) => c.startsWith("mark:")));
});

test("desktop runner: no read call rejects before the backup or any deps load", async () => {
  const sink = new MemorySink();
  const { shell, calls } = fakeShell(sink, { noRead: true });
  let loaded = false;
  const runner = makeDesktopRunner(shell, async () => {
    loaded = true;
    return deps(sink)();
  });
  await assert.rejects(runner(FOLDER, () => {}), /migrate097Read not wired/);
  assert.equal(loaded, false);
  assert.deepEqual(calls, []);
});

test("desktop runner: no backup call refuses, with no read and no mark", async () => {
  const { calls, runner } = setup({ noBackup: true });
  const reply = await runner(FOLDER, () => {});
  assert.notEqual(reply.state, "verified");
  assert.ok(!calls.some((c) => c.startsWith("read:") || c.startsWith("mark:")));
});

test("desktop runner: a failed mark leaves the run unverified", async () => {
  const { calls, runner } = setup({ markFails: true });
  const reply = await runner(FOLDER, () => {});
  assert.notEqual(reply.state, "verified");
  assert.ok(calls.includes(`mark:${FOLDER}`));
});

test("desktop runner: an open vault other than the folder rejects before any shell call", async () => {
  for (const vault of ["C:/other", null]) {
    const { calls, runner } = setup({ vault });
    await assert.rejects(runner(FOLDER, () => {}), /open workspace is not the folder/);
    assert.deepEqual(calls, []);
  }
});

test("desktop runner: the open vault matches the folder across separators, a trailing slash and drive-letter case", async () => {
  for (const vault of ["C:\\ws", "c:\\ws\\", "C:/WS/"]) {
    const { calls, runner } = setup({ vault });
    const reply = await runner(FOLDER, () => {});
    assert.equal(reply.state, "verified", vault);
    assert.equal(calls.at(-1), `mark:${FOLDER}`);
  }
  const { calls, runner } = setup({ vault: "C:\\ws2" });
  await assert.rejects(runner(FOLDER, () => {}), /open workspace is not the folder/);
  assert.deepEqual(calls, []);
});

test("sameFolder: a verbatim prefix is dropped and a verbatim UNC path matches its plain form", () => {
  assert.equal(sameFolder("\\\\?\\C:\\Vault", "c:/vault/"), true);
  assert.equal(sameFolder("\\\\?\\UNC\\server\\share\\ws", "\\\\server\\share\\ws"), true);
  assert.equal(sameFolder("\\\\server\\share\\ws", "\\\\server\\share\\ws\\"), true);
  assert.equal(sameFolder("\\\\server\\share\\ws", "\\\\server\\share\\ws2"), false);
});

test("sameFolder: POSIX paths stay case-sensitive", () => {
  assert.equal(sameFolder("/home/u/ws/", "/home/u/ws"), true);
  assert.equal(sameFolder("/home/u/WS", "/home/u/ws"), false);
});

test("desktop runner: a vault switched during the run is never marked", async () => {
  const { calls, runner } = setup({ vaultAfterBackup: "C:/other" });
  const reply = await runner(FOLDER, () => {});
  assert.notEqual(reply.state, "verified");
  assert.ok(!calls.some((c) => c.startsWith("mark:")));
});

test("desktop runner: the reply carries archivedOnly, reconnectProviders and undecryptable from the run", async () => {
  const sink = new MemorySink();
  const { shell } = fakeShell(sink);
  const stub = async (): Promise<ExportResult> =>
    ({
      state: "incomplete",
      run: { missing: [] },
      reconnectProviders: ["zotero"],
      undecryptable: 2,
      archivedOnly: ["ink"],
    }) as unknown as ExportResult;
  const reply = await makeDesktopRunner(shell, deps(sink), stub, () => NOW)(FOLDER, () => {});
  assert.deepEqual(reply, {
    state: "incomplete",
    reconnectProviders: ["zotero"],
    undecryptable: 2,
    pendingSync: false,
    archivedOnly: ["ink"],
  });
});

test("desktopDeps: the app's deps export every migration kind through writers over the vault sink", async () => {
  const bridge = {
    vaultRoot: async () => ({ path: FOLDER, state: "existing" }),
    listVaultFiles: async () => [],
  } as unknown as DesktopBridge;
  const loaded = await desktopDeps(bridge)();
  assert.deepEqual(loaded.kinds, MIGRATION_KINDS);
  assert.equal(typeof loaded.codec.toFile, "function");
  assert.equal(typeof loaded.sink.write, "function");
  assert.ok((loaded.writers?.(loaded.sink).length ?? 0) > 0);
});

const projectJson = async (sink: MemorySink, folder: string) => {
  const path = folder ? `${folder}/.weaveforge/project.json` : ".weaveforge/workspace.json";
  return (await sink.exists(path)) ? (JSON.parse(await sink.readText(path)) as Record<string, unknown>) : null;
};

const THESIS = { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Thesis", color: "#336699", createdAt: "2026-01-02T03:04:05.000Z" };
const SIDE = { id: "bbbbbbbb-0000-0000-0000-000000000002", name: "Side", createdAt: "2026-01-03T00:00:00.000Z" };

test("desktop runner: a verified run gives each exported folder its project file", async () => {
  const projects = [
    { project: THESIS, folder: "thesis--aaaaaa" },
    { project: SIDE, folder: "side--bbbbbb" },
  ];
  const { sink, runner } = setup({}, projects);
  assert.equal((await runner(FOLDER, () => {})).state, "verified");
  assert.deepEqual(await projectJson(sink, "thesis--aaaaaa"), THESIS);
  assert.deepEqual(await projectJson(sink, "side--bbbbbb"), SIDE);
});

test("desktop runner: a project already in the folder is kept", async () => {
  const own = { id: "mine", name: "Mine", createdAt: NOW };
  const { sink, runner } = setup({}, [{ project: { ...own, name: "Renamed" }, folder: "" }]);
  await sink.write(".weaveforge/workspace.json", JSON.stringify(own));
  assert.equal((await runner(FOLDER, () => {})).state, "verified");
  assert.deepEqual(await projectJson(sink, ""), own);
});

const projectShell = (rows: unknown[] | Error) => ({
  vaultRoot: async () => ({ path: "C:\\data\\ws", state: "existing" as const }),
  queryLocalDb: async (sql: string) => {
    assert.match(sql, /from projects/);
    if (rows instanceof Error) throw rows;
    return rows as Record<string, unknown>[];
  },
});

test("exportedProjects: every database project, main first, each in its own slug--id6 folder", async () => {
  const rows = [
    { id: "aaaaaaaa-0000-0000-0000-000000111111", name: "Thesis", color: "#336699", created_at: "2026-01-02 03:04:05+00" },
    { id: "bbbbbbbb-0000-0000-0000-000000222222", name: "Side", color: null, created_at: "2026-01-03 00:00:00+00" },
  ];
  const got = await exportedProjects(projectShell(rows) as never, sinkAsWorkspaceFs(new MemorySink()));
  assert.deepEqual(got.map((p) => p.project), [
    { id: rows[0]!.id, name: "Thesis", color: "#336699", createdAt: "2026-01-02T03:04:05.000Z" },
    { id: rows[1]!.id, name: "Side", createdAt: "2026-01-03T00:00:00.000Z" },
  ]);
  assert.deepEqual(got.map((p) => p.folder), ["thesis--aaaaaa", "side--bbbbbb"]);
});

test("exportedProjects: a project already in the workspace keeps its folder", async () => {
  const sink = new MemorySink();
  const id = "aaaaaaaa-0000-0000-0000-000000111111";
  await sink.write("My Thesis/.weaveforge/project.json", JSON.stringify({ id, name: "Thesis", createdAt: NOW }));
  const rows = [{ id, name: "Thesis", color: null, created_at: "2026-01-02 03:04:05+00" }];
  const got = await exportedProjects(projectShell(rows) as never, sinkAsWorkspaceFs(sink));
  assert.deepEqual(got.map((p) => p.folder), ["My Thesis"]);
});

test("exportedProjects: with no project row one project named after the folder holds every row", async () => {
  const got = await exportedProjects(projectShell([]) as never, sinkAsWorkspaceFs(new MemorySink()), NOW);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.project.name, "ws");
  assert.match(got[0]!.project.id, /^[0-9a-f-]{36}$/);
  assert.equal(got[0]!.folder, `ws--${got[0]!.project.id.slice(0, 6)}`);
});

test("exportedProjects: a failed project query fails, so no run starts with rows nowhere to go", async () => {
  await assert.rejects(exportedProjects(projectShell(new Error("db down")) as never, sinkAsWorkspaceFs(new MemorySink())), /db down/);
});
