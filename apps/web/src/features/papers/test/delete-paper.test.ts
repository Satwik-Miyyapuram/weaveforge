/**
 * Deleting a paper (25-04): a failed Zotero delete is logged, and the local
 * delete still goes ahead.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Paper } from "@weaveforge/core";
import { DeletePaperUseCase } from "../application/parts-1";

type Log = { level: string; source: string; message: string; detail?: string };

function useCase(removeRemote: () => Promise<void>, removeImage: (path: string) => Promise<void> = async () => {}) {
  const removed: string[] = [];
  // An image store is still handed in, so a delete that reaches for it again
  // shows up in the image test below.
  const deps = {
    bibliography: { removeRemotePaper: removeRemote } as never,
    images: { remove: removeImage },
    updatePaper: { remove: async (id: string) => void removed.push(id) } as never,
    papers: {} as never,
  };
  const uc = new DeletePaperUseCase(deps);
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

// P2-173/190: a delete moves the paper file to the workspace trash, and a
// restored file still points at its `paperimg:` figures. Removing them at
// trash time made every restore lose its images, so they stay.
test("trashing a paper keeps every image, so a restored paper loses nothing (P2-173)", async () => {
  const gone: string[] = [];
  const { uc, removed } = useCase(async () => {}, async (path) => void gone.push(path));
  const logs = await withDesktopLog(() => uc.execute(paper({ images: ["u/p1/a.png", "u/p1/b.png"] })));
  assert.deepEqual(removed, ["p1"]);
  assert.deepEqual(gone, []);
  assert.deepEqual(logs, []);
});

test("a failed row delete keeps the Zotero item and every image (P2-173, P2-190)", async () => {
  const touched: string[] = [];
  const deps = {
    bibliography: { removeRemotePaper: async (key: string) => void touched.push(key) } as never,
    images: { remove: async (path: string) => void touched.push(path) },
    updatePaper: { remove: async () => { throw new Error("disk full"); } } as never,
    papers: {} as never,
  };
  const uc = new DeletePaperUseCase(deps);
  await assert.rejects(() => uc.execute(paper({ zoteroKey: "ZK1", images: ["u/p1/a.png"] })), /disk full/);
  assert.deepEqual(touched, []);
});