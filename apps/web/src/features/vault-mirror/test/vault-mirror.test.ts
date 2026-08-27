import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkspacePathError, type WorkspaceSnapshot } from "@weaveforge/core";
import { MemoryWorkspaceFs, emptyWorkspaceSnapshot } from "@weaveforge/core/testing";

import { DesktopVaultFs, type VaultFileBridge } from "../application/desktop-vault-fs";
import { MIRROR_MANIFEST_PATH, createMirrorRunner } from "../application/mirror-runner";

/** A bridge backed by the in-memory fs, standing in for the desktop process. */
function bridgeOver(fs: MemoryWorkspaceFs): VaultFileBridge {
  return {
    async readVaultFile(path) {
      return fs.readText(path).catch(() => null);
    },
    async writeVaultFile(path, contents) {
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir) await fs.mkdirp(dir);
      await fs.writeFile(path, contents);
    },
    async listVaultFiles(path) {
      return fs.list(path ?? "");
    },
    async statVaultFile(path) {
      return fs.stat(path);
    },
    async removeVaultFile(path) {
      await fs.remove(path);
    },
  };
}

function snapshotWith(notes: { id: string; title: string; body: string }[]): WorkspaceSnapshot {
  return {
    ...emptyWorkspaceSnapshot(),
    vaultPages: notes.map((note, index) => ({
      id: note.id,
      title: note.title,
      body: note.body,
      sortOrder: index,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })),
  };
}

test("the adapter round trips a file through the bridge", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  await fs.writeFile("notes/one.note.md", "hello");
  assert.equal(await fs.readText("notes/one.note.md"), "hello");
  assert.equal((await fs.stat("notes/one.note.md"))?.kind, "file");
});

test("a missing file throws on read and stats as null", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  await assert.rejects(() => fs.readText("gone.md"));
  assert.equal(await fs.stat("gone.md"), null);
});

test("the adapter refuses a path that leaves the root", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  await assert.rejects(() => fs.writeFile("../escape.md", "x"), WorkspacePathError);
  await assert.rejects(() => fs.readText("/etc/passwd"), WorkspacePathError);
  // The guard runs before the swallow-and-return-null in `stat`, so an unsafe
  // path is an error rather than a quiet "not there".
  await assert.rejects(() => fs.stat("../escape.md"), WorkspacePathError);
});

test("walk descends where list does not", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  await fs.writeFile("a/b/deep.md", "x");
  assert.deepEqual(
    (await fs.list("a")).map((entry) => entry.kind),
    ["dir"],
  );
  const walked: string[] = [];
  for await (const entry of fs.walk("a")) walked.push(entry.path);
  assert.deepEqual(walked, ["a/b/deep.md"]);
});

test("rename copies and then drops the original", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  await fs.writeFile("old.md", "body");
  await fs.rename("old.md", "new.md");
  assert.equal(await fs.readText("new.md"), "body");
  assert.equal(await fs.stat("old.md"), null);
});

test("a mirror run writes the folder and records what it wrote", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  const runner = createMirrorRunner({
    fs,
    collect: async () => snapshotWith([{ id: "n1", title: "Methods", body: "# Methods" }]),
  });

  const result = await runner.runNow();
  assert.ok(result);
  assert.ok(result.written.length > 0);
  const manifest = JSON.parse(await fs.readText(MIRROR_MANIFEST_PATH)) as { paths: string[] };
  assert.deepEqual(manifest.paths, [...result.written].sort());
});

test("a second run over an unchanged workspace writes nothing", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  const collect = async () => snapshotWith([{ id: "n1", title: "Methods", body: "# Methods" }]);
  const runner = createMirrorRunner({ fs, collect });

  await runner.runNow();
  const second = await runner.runNow();
  assert.ok(second);
  assert.deepEqual(second.written, []);
  assert.ok(second.unchanged > 0);
});

test("a note that leaves the workspace takes its file with it", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  let notes = [
    { id: "n1", title: "Methods", body: "one" },
    { id: "n2", title: "Results", body: "two" },
  ];
  const runner = createMirrorRunner({ fs, collect: async () => snapshotWith(notes) });

  const first = await runner.runNow();
  assert.ok(first);
  const dropped = first.written.find((path) => path.includes("results"));
  assert.ok(dropped, "expected a file for the note being removed");

  notes = notes.slice(0, 1);
  const second = await runner.runNow();
  assert.ok(second);
  assert.ok(second.removed.includes(dropped));
  assert.equal(await fs.stat(dropped), null);

  const manifest = JSON.parse(await fs.readText(MIRROR_MANIFEST_PATH)) as { paths: string[] };
  assert.ok(!manifest.paths.includes(dropped));
});

test("a file the mirror does not own survives a run", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  await fs.writeFile("my-own-note.md", "mine");
  const runner = createMirrorRunner({
    fs,
    collect: async () => snapshotWith([{ id: "n1", title: "Methods", body: "x" }]),
  });
  await runner.runNow();
  assert.equal(await fs.readText("my-own-note.md"), "mine");
});

test("a run requested mid-flight happens again afterwards", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  let collected = 0;
  const runner = createMirrorRunner({
    fs,
    collect: async () => {
      collected += 1;
      // Ask for another run while the first one is still collecting.
      if (collected === 1) void runner.runNow();
      return snapshotWith([{ id: "n1", title: "Methods", body: `body ${collected}` }]);
    },
  });

  await runner.runNow();
  assert.equal(collected, 2, "the request that landed mid-run should not be dropped");
});

test("a suspended runner stands down, and stopping cancels a pending request", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  let collected = 0;
  const timers: (() => void)[] = [];
  const runner = createMirrorRunner({
    fs,
    debounceMs: 0,
    setTimeoutFn: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeoutFn: () => timers.pop(),
    collect: async () => {
      collected += 1;
      return snapshotWith([]);
    },
  });

  runner.suspended = true;
  runner.request();
  assert.equal(await runner.runNow(), null);
  assert.equal(collected, 0);

  runner.suspended = false;
  runner.request();
  runner.stop();
  for (const fire of timers) fire();
  assert.equal(collected, 0, "a stopped runner should not collect");
});

test("a mirror failure is reported rather than thrown", async () => {
  const fs = new DesktopVaultFs(bridgeOver(new MemoryWorkspaceFs()));
  const seen: unknown[] = [];
  const runner = createMirrorRunner({
    fs,
    collect: async () => {
      throw new Error("database unreachable");
    },
    onError: (error) => seen.push(error),
  });

  assert.equal(await runner.runNow(), null);
  assert.equal(seen.length, 1);
});
