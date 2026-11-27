/** The desktop folder's read cache: repeats served from memory, every change seen. */
import assert from "node:assert/strict";
import { beforeEach, before, test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";

import { loadTestCore } from "@/lib/test/load-test-core";

import {
  DesktopWorkspaceFs,
  type VaultFileBridge,
} from "../infrastructure/parts";
import { resetVaultCacheForTests } from "../infrastructure/vault-read-cache";

before(async () => {
  await loadTestCore();
});

beforeEach(() => {
  resetVaultCacheForTests();
});

type Calls = { read: number; stat: number; list: number };

/** A bridge over the in-memory fs that counts the calls it actually serves. */
function countingBridge(fs: MemoryWorkspaceFs) {
  const calls: Calls = { read: 0, stat: 0, list: 0 };
  let onChange: ((paths: string[]) => void) | undefined;
  let onLost: ((reason: string) => void) | undefined;
  const bridge: VaultFileBridge = {
    async readVaultFile(path) {
      calls.read++;
      return fs.readText(path).catch(() => null);
    },
    async writeVaultFile(path, contents) {
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir) await fs.mkdirp(dir);
      await fs.writeFile(path, contents);
    },
    async readVaultBytes(path) {
      return fs.readFile(path).catch(() => null);
    },
    async writeVaultBytes(path, bytes) {
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir) await fs.mkdirp(dir);
      await fs.writeFile(path, bytes);
    },
    async listVaultFiles(path) {
      calls.list++;
      return fs.list(path ?? "");
    },
    async statVaultFile(path) {
      calls.stat++;
      return fs.stat(path);
    },
    async removeVaultFile(path) {
      await fs.remove(path);
    },
    onVaultChange(cb) {
      onChange = cb;
      return () => {};
    },
    onVaultWatchLost(cb) {
      onLost = cb;
      return () => {};
    },
  };
  return {
    bridge,
    calls,
    emit: (paths: string[]) => onChange?.(paths),
    lose: () => onLost?.("watcher stopped"),
  };
}

test("two reads of the same path reach the bridge once", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "hello");
  const { bridge, calls } = countingBridge(fs);
  const a = new DesktopWorkspaceFs(bridge);
  assert.equal(await a.readText("notes/a.md"), "hello");
  assert.equal(await a.readText("notes/a.md"), "hello");
  assert.equal(calls.read, 1);
});

test("concurrent reads share one bridge call", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "hello");
  const { bridge, calls } = countingBridge(fs);
  const a = new DesktopWorkspaceFs(bridge);
  const [x, y] = await Promise.all([a.readText("notes/a.md"), a.readText("notes/a.md")]);
  assert.equal(x, "hello");
  assert.equal(y, "hello");
  assert.equal(calls.read, 1);
});

test("a bridge without a watcher is never cached", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "hello");
  const { bridge, calls } = countingBridge(fs);
  delete bridge.onVaultChange;
  const a = new DesktopWorkspaceFs(bridge);
  await a.readText("notes/a.md");
  await a.readText("notes/a.md");
  assert.equal(calls.read, 2);
});

test("a write through one instance is seen by another on the same bridge", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "old");
  const { bridge } = countingBridge(fs);
  const instanceA = new DesktopWorkspaceFs(bridge);
  const instanceB = new DesktopWorkspaceFs(bridge);
  assert.equal(await instanceA.readText("notes/a.md"), "old");
  await instanceA.writeFile("notes/a.md", "new");
  assert.equal(await instanceB.readText("notes/a.md"), "new");
});

test("an outside edit is hidden until the watcher reports it", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "old");
  const { bridge, emit } = countingBridge(fs);
  const a = new DesktopWorkspaceFs(bridge);
  assert.equal(await a.readText("notes/a.md"), "old");
  await fs.writeFile("notes/a.md", "outside");
  assert.equal(await a.readText("notes/a.md"), "old");
  emit(["notes/a.md"]);
  assert.equal(await a.readText("notes/a.md"), "outside");
});

test("the overflow marker drops every cached read", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "old");
  const { bridge, calls, emit } = countingBridge(fs);
  const a = new DesktopWorkspaceFs(bridge);
  await a.readText("notes/a.md");
  emit(["\0overflow"]);
  await a.readText("notes/a.md");
  assert.equal(calls.read, 2);
});

test("after the watcher is lost, every read reaches the bridge", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "old");
  const { bridge, calls, lose } = countingBridge(fs);
  const a = new DesktopWorkspaceFs(bridge);
  await a.readText("notes/a.md");
  lose();
  await a.readText("notes/a.md");
  await a.readText("notes/a.md");
  assert.equal(calls.read, 3);
});

test("workspace and git metadata are never cached", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile(".weaveforge/workspace.json", "{}");
  await fs.writeFile(".git/HEAD", "ref");
  const { bridge, calls } = countingBridge(fs);
  const a = new DesktopWorkspaceFs(bridge);
  await a.readText(".weaveforge/workspace.json");
  await a.readText(".weaveforge/workspace.json");
  await a.readText(".git/HEAD");
  await a.readText(".git/HEAD");
  assert.equal(calls.read, 4);
});

test("a missing file keeps failing until it is created and the watcher reports it", async () => {
  const fs = new MemoryWorkspaceFs();
  const { bridge, emit } = countingBridge(fs);
  const a = new DesktopWorkspaceFs(bridge);
  await assert.rejects(a.readText("notes/new.md"), /ENOENT/);
  await assert.rejects(a.readText("notes/new.md"), /ENOENT/);
  await fs.writeFile("notes/new.md", "created");
  emit(["notes/new.md"]);
  assert.equal(await a.readText("notes/new.md"), "created");
});

test("a rejected bridge read is not cached", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "hello");
  const { bridge, calls } = countingBridge(fs);
  const original = bridge.readVaultFile;
  let failed = false;
  bridge.readVaultFile = async (path) => {
    if (!failed) {
      failed = true;
      calls.read++;
      throw new Error("shell busy");
    }
    return original(path);
  };
  const a = new DesktopWorkspaceFs(bridge);
  await assert.rejects(a.readText("notes/a.md"), /shell busy/);
  assert.equal(await a.readText("notes/a.md"), "hello");
  assert.equal(calls.read, 2);
});

test("a read in flight when its path changes is not kept", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "old");
  const { bridge, calls, emit } = countingBridge(fs);
  const original = bridge.readVaultFile;
  let release!: (text: string | null) => void;
  const held = new Promise<string | null>((resolve) => {
    release = resolve;
  });
  let first = true;
  bridge.readVaultFile = async (path) => {
    if (first) {
      first = false;
      calls.read++;
      return held;
    }
    return original(path);
  };
  const a = new DesktopWorkspaceFs(bridge);
  const pending = a.readText("notes/a.md");
  emit(["notes/a.md"]);
  release("old");
  assert.equal(await pending, "old");
  await a.readText("notes/a.md");
  assert.equal(calls.read, 2);
});

test("a listing is kept until any write", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "hello");
  const { bridge, calls } = countingBridge(fs);
  const a = new DesktopWorkspaceFs(bridge);
  await a.list("notes");
  await a.list("notes");
  assert.equal(calls.list, 1);
  await a.writeFile("other.md", "x");
  await a.list("notes");
  assert.equal(calls.list, 2);
});

test("a stat is kept until its path or an ancestor changes", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "hello");
  const { bridge, calls, emit } = countingBridge(fs);
  const a = new DesktopWorkspaceFs(bridge);
  await a.stat("notes/a.md");
  await a.stat("notes/a.md");
  assert.equal(calls.stat, 1);
  emit(["notes/a.md"]);
  await a.stat("notes/a.md");
  assert.equal(calls.stat, 2);
  await a.readText("notes/a.md");
  emit(["notes"]);
  await a.stat("notes/a.md");
  await a.readText("notes/a.md");
  assert.equal(calls.stat, 3);
  assert.equal(calls.read, 2);
});

test("a refused checked write drops the cached text", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "old");
  const { bridge, calls } = countingBridge(fs);
  bridge.writeVaultFileIf = async () => false;
  const a = new DesktopWorkspaceFs(bridge);
  assert.equal(await a.readText("notes/a.md"), "old");
  assert.equal(await a.writeTextIf("notes/a.md", "x", "wrong"), false);
  await a.readText("notes/a.md");
  assert.equal(calls.read, 2);
});

test("a removed file is not served from the cache", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("notes/a.md", "hello");
  const { bridge } = countingBridge(fs);
  const a = new DesktopWorkspaceFs(bridge);
  await a.readText("notes/a.md");
  await a.remove("notes/a.md");
  await assert.rejects(a.readText("notes/a.md"), /ENOENT/);
});
