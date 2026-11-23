import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySink } from "@/features/migration-097/infrastructure/memory-sink";
import { OUTBOX_NOT_EMPTY_REASON, type ExportResult } from "@/features/migration-097/application/run-web-export";
import { MIGRATION_KINDS } from "@/features/migration-097/domain/report";
import { FIXTURE, KINDS, SUPPORTED, fakeCodec } from "@/features/migration-097/test/web-export/helpers";
import { onlyReportPath } from "@/features/migration-097/test/own-report";
import type { DesktopBridge } from "../desktop-bridge";
import { desktopDeps, makeDesktopRunner, sameFolder, type DesktopExportShell } from "../migrate-097-desktop";

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
};

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
  };
  return { shell, calls };
}

const deps = (sink: MemorySink) => async () => ({ codec: fakeCodec(SUPPORTED), sink, kinds: KINDS });

function setup(opts: ShellOpts = {}) {
  const sink = new MemorySink();
  const { shell, calls } = fakeShell(sink, opts);
  return { sink, shell, calls, runner: makeDesktopRunner(shell, deps(sink), undefined, () => NOW) };
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
  const bridge = { vaultRoot: async () => ({ path: FOLDER, state: "existing" }) } as unknown as DesktopBridge;
  const loaded = await desktopDeps(bridge)();
  assert.deepEqual(loaded.kinds, MIGRATION_KINDS);
  assert.equal(typeof loaded.codec.toFile, "function");
  assert.equal(typeof loaded.sink.write, "function");
  assert.ok((loaded.writers?.(loaded.sink).length ?? 0) > 0);
});
