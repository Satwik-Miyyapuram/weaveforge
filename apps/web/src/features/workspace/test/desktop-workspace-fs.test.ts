import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkspacePathError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@weaveforge/core/testing";

import {
  DesktopWorkspaceFs,
  type VaultFileBridge,
} from "../infrastructure/desktop-workspace-fs";

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

function adapter(): DesktopWorkspaceFs {
  return new DesktopWorkspaceFs(bridgeOver(new MemoryWorkspaceFs()));
}

test("the adapter round trips a file through the bridge", async () => {
  const fs = adapter();
  await fs.writeFile("notes/one.note.md", "hello");
  assert.equal(await fs.readText("notes/one.note.md"), "hello");
  assert.equal((await fs.stat("notes/one.note.md"))?.kind, "file");
});

test("bytes survive the trip in both directions", async () => {
  const fs = adapter();
  await fs.writeFile("notes/two.note.md", new TextEncoder().encode("héllo"));
  assert.deepEqual(await fs.readFile("notes/two.note.md"), new TextEncoder().encode("héllo"));
});

test("a missing file throws on read and stats as null", async () => {
  const fs = adapter();
  // The port's contract is that a missing file throws, while the bridge answers
  // null so that asking about one is not an error in itself.
  await assert.rejects(() => fs.readText("gone.md"));
  assert.equal(await fs.stat("gone.md"), null);
});

test("the adapter refuses a path that leaves the root", async () => {
  const fs = adapter();
  await assert.rejects(() => fs.writeFile("../escape.md", "x"), WorkspacePathError);
  await assert.rejects(() => fs.readText("/etc/passwd"), WorkspacePathError);
  await assert.rejects(() => fs.remove("../escape.md"), WorkspacePathError);
  // The guard runs before the swallow-and-return-null in `stat`, so an unsafe
  // path is an error rather than a quiet "not there".
  await assert.rejects(() => fs.stat("../escape.md"), WorkspacePathError);
});

test("walk descends where list does not", async () => {
  const fs = adapter();
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
  const fs = adapter();
  await fs.writeFile("old.md", "body");
  await fs.rename("old.md", "new.md");
  assert.equal(await fs.readText("new.md"), "body");
  assert.equal(await fs.stat("old.md"), null);
});

test("mkdirp is a no-op, and a write still creates its parents", async () => {
  const fs = adapter();
  await fs.mkdirp("nothing/here");
  assert.equal(await fs.stat("nothing/here"), null);
  await fs.writeFile("nothing/here/file.md", "x");
  assert.equal((await fs.stat("nothing/here"))?.kind, "dir");
});
