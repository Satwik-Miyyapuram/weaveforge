import assert from "node:assert/strict";
import { test } from "node:test";

import type { IWorkspaceGit, WorkspaceCommit } from "@weaveforge/core";

import { gitFileHistory, shellFileHistory } from "../application/folder-file-history";

const commit = (oid: string): WorkspaceCommit => ({
  oid,
  message: `m ${oid}`,
  authoredAt: "2026-11-06T10:00:00Z",
  author: "WeaveForge",
});

test("the shell source asks the shell for one file's commits and its text at each", async () => {
  const calls: unknown[][] = [];
  const source = shellFileHistory({
    vaultFileLog: async (path, limit) => {
      calls.push(["log", path, limit]);
      return [commit("b"), commit("a")];
    },
    vaultReadAt: async (oid, path) => {
      calls.push(["at", oid, path]);
      return oid === "a" ? "one" : null;
    },
  });
  assert.ok(source);
  assert.deepEqual(
    (await source.log("notes/a.md", 5)).map((c) => c.oid),
    ["b", "a"],
  );
  assert.equal(await source.readAt("a", "notes/a.md"), "one");
  assert.equal(await source.readAt("b", "notes/a.md"), null);
  assert.deepEqual(calls, [
    ["log", "notes/a.md", 5],
    ["at", "a", "notes/a.md"],
    ["at", "b", "notes/a.md"],
  ]);
});

test("a shell too old for file history gives no source", () => {
  assert.equal(shellFileHistory({}), null);
  assert.equal(shellFileHistory({ vaultFileLog: async () => [] }), null);
});

test("the browser source filters the log by path and decodes only UTF-8 text", async () => {
  const seen: unknown[] = [];
  const files: Record<string, Uint8Array> = {
    "a:text.md": new TextEncoder().encode("héllo"),
    "a:blob.bin": new Uint8Array([0xff, 0xfe, 0x00]),
  };
  const git = {
    log: async (options?: { path?: string; limit?: number }) => {
      seen.push(options);
      return [commit("a")];
    },
    readAt: async (oid: string, path: string) => files[`${oid}:${path}`] ?? null,
  } as unknown as IWorkspaceGit;
  const source = gitFileHistory(git);

  assert.equal((await source.log("text.md", 3)).length, 1);
  assert.deepEqual(seen, [{ path: "text.md", limit: 3 }]);
  assert.equal(await source.readAt("a", "text.md"), "héllo");
  assert.equal(await source.readAt("a", "blob.bin"), null, "not text");
  assert.equal(await source.readAt("a", "gone.md"), null, "absent at that commit");
});
