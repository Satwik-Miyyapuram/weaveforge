/**
 * Deleting a paper (25-04): a failed Zotero delete is logged, and the local
 * delete still goes ahead.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Paper } from "@weaveforge/core";
import { DeletePaperUseCase } from "../application/delete-paper.use-case";

type Log = { level: string; source: string; message: string; detail?: string };

function useCase(removeRemote: () => Promise<void>, removeImage: (path: string) => Promise<void> = async () => {}) {
  const removed: string[] = [];
  const uc = new DeletePaperUseCase({
    bibliography: { removeRemotePaper: removeRemote } as never,
    images: { remove: removeImage } as never,
    updatePaper: { remove: async (id: string) => void removed.push(id) } as never,
    papers: {} as never,
  });
  return { uc, removed };
}

async function withDesktopLog(run: () => Promise<void>): Promise<Log[]> {
  const logs: Log[] = [];
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) },
  };
  try {
    await run();
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
  return logs;
}

const paper = (metadata?: Record<string, unknown>) => ({ id: "p1", title: "T", metadata }) as unknown as Paper;

test("a failed Zotero delete is logged and the local delete proceeds (25-04)", async () => {
  const { uc, removed } = useCase(() => Promise.reject(new Error("403 forbidden")));
  const logs = await withDesktopLog(() => uc.execute(paper({ zoteroKey: "ZK1" })));
  assert.deepEqual(removed, ["p1"]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.match(logs[0]!.detail ?? "", /ZK1/);
  assert.match(logs[0]!.detail ?? "", /403 forbidden/);
});

test("a paper with no Zotero key never calls Zotero and logs nothing", async () => {
  let calls = 0;
  const { uc, removed } = useCase(async () => void (calls += 1));
  const logs = await withDesktopLog(() => uc.execute(paper()));
  assert.equal(calls, 0);
  assert.deepEqual(removed, ["p1"]);
  assert.deepEqual(logs, []);
});

// xlog-11: an image left behind in storage is traceable, and the delete still goes ahead.
test("a failed image delete is logged per image, and the rest and the row still go", async () => {
  const gone: string[] = [];
  const { uc, removed } = useCase(
    async () => {},
    async (path) => {
      if (path.endsWith("bad.png")) throw new Error("503 storage down");
      gone.push(path);
    },
  );
  const logs = await withDesktopLog(() => uc.execute(paper({ images: ["u/p1/ok.png", "u/p1/bad.png"] })));
  assert.deepEqual(gone, ["u/p1/ok.png"]);
  assert.deepEqual(removed, ["p1"]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.source, "storage");
  assert.match(logs[0]!.detail ?? "", /u\/p1\/bad\.png/);
  assert.match(logs[0]!.detail ?? "", /503 storage down/);
});

test("images that delete cleanly log nothing", async () => {
  const { uc, removed } = useCase(async () => {});
  const logs = await withDesktopLog(() => uc.execute(paper({ images: ["u/p1/a.png", "u/p1/b.png"] })));
  assert.deepEqual(removed, ["p1"]);
  assert.deepEqual(logs, []);
});
