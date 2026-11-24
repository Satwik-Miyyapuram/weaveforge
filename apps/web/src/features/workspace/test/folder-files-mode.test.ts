import assert from "node:assert/strict";
import { before, test } from "node:test";

import { setContainerForTests } from "@/bootstrap";
import { loadTestCore } from "@/lib/test/load-test-core";
import {
  autoApplyScheduled,
  chooseDesktopFolder,
  closeFolder,
  externalChanges,
  syncToFolder,
} from "../application/workspace-folder";

before(async () => {
  await loadTestCore();
});

/** A shell that records each commit and every write into the folder. */
function fakeShell() {
  const writes: string[] = [];
  let commits = 0;
  let emit: ((paths: string[]) => void) | null = null;
  const write = (path: string) => {
    writes.push(path);
    return Promise.resolve();
  };
  const bridge = {
    fetchTitle: () => Promise.resolve(null),
    vaultRoot: () => Promise.resolve({ path: "/notes" }),
    readVaultFile: () => Promise.resolve("edited outside"),
    writeVaultFile: write,
    writeVaultText: write,
    removeVaultFile: write,
    renameVaultFile: write,
    commitVault: () => {
      commits += 1;
      return Promise.resolve({ commit: null });
    },
    onVaultChange: (listener: (paths: string[]) => void) => {
      emit = listener;
      return () => undefined;
    },
  };
  (globalThis as { window?: unknown }).window = { weaveforge: bridge };
  return { writes, commits: () => commits, emit: (paths: string[]) => emit?.(paths) };
}

async function connected(t: { after(fn: () => void): void }) {
  t.after(() => {
    closeFolder();
    setContainerForTests(null);
  });
  const read = { snapshots: 0 };
  setContainerForTests({
    workspace: {
      filesMode: true,
      snapshot: () => {
        read.snapshots += 1;
        return Promise.reject(new Error("not read in files mode"));
      },
    },
    projects: { context: { projectId: "p1" } },
  } as never);
  const shell = fakeShell();
  assert.ok(await chooseDesktopFolder({ git: false, reuse: true }));
  return { shell, read };
}

test("files mode commits the folder and mirrors nothing into it", async (t) => {
  const { shell, read } = await connected(t);
  read.snapshots = 0;
  const { mirror } = await syncToFolder();
  assert.deepEqual(mirror.written, []);
  assert.deepEqual(shell.writes, []);
  assert.equal(read.snapshots, 0);
  assert.ok(shell.commits() > 0);
});

test("files mode takes an outside edit as the data, not as an import to apply", async (t) => {
  const { shell } = await connected(t);
  shell.emit(["notes/outside.md"]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(externalChanges(), []);
  assert.equal(autoApplyScheduled(), false);
});
