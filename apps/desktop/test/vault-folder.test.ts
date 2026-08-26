import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeWorkspaceFs, rootFingerprint, verifyRoot } from "../src/vault-folder";
import {
  adoptRoot,
  currentRoot,
  forgetRoot,
  listVaultFiles,
  newVaultSession,
  readVaultFile,
  writeVaultFile,
} from "../src/vault-handlers";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "weaveforge-vault-"));
}

// ------------------------------------------------------------- choosing a root

test("an empty folder may become the workspace", async () => {
  assert.deepEqual(await verifyRoot(await tempDir()), { ok: true, state: "empty" });
});

test("a folder we already wrote is recognized as ours", async () => {
  const root = await tempDir();
  await mkdir(path.join(root, ".weaveforge"));
  await writeFile(path.join(root, "notes.md"), "not empty");
  assert.deepEqual(await verifyRoot(root), { ok: true, state: "existing" });
});

test("somebody's Documents folder is refused", async () => {
  const root = await tempDir();
  await writeFile(path.join(root, "taxes.pdf"), "mine");
  const verdict = await verifyRoot(root);
  assert.equal(verdict.ok, false);
});

test("dotfiles nobody chose to put there do not count as contents", async () => {
  const root = await tempDir();
  await writeFile(path.join(root, ".DS_Store"), "");
  assert.deepEqual(await verifyRoot(root), { ok: true, state: "empty" });
});

test("a file is not a folder", async () => {
  const root = await tempDir();
  const file = path.join(root, "note.md");
  await writeFile(file, "");
  assert.equal((await verifyRoot(file)).ok, false);
});

test("the fingerprint is stable and reveals nothing", () => {
  const one = rootFingerprint("/home/someone/vault");
  assert.equal(one, rootFingerprint("/home/someone/vault"));
  assert.equal(one.includes("someone"), false);
});

// -------------------------------------------------------------------- the port

test("a file written is a file read back", async () => {
  const fs = new NodeWorkspaceFs(await tempDir());
  await fs.writeFile("notes/method.note.md", "Body.");
  assert.equal(await fs.readText("notes/method.note.md"), "Body.");
});

test("a path leaving the root is refused before it reaches disk", async () => {
  const fs = new NodeWorkspaceFs(await tempDir());
  await assert.rejects(() => fs.writeFile("../escaped.md", "no"));
  await assert.rejects(() => fs.writeFile("/etc/passwd", "no"));
});

test("a symlink out of the folder is refused too", async () => {
  const root = await tempDir();
  const outside = await tempDir();
  try {
    await symlink(outside, path.join(root, "away"), "dir");
  } catch {
    return; // No permission to make links on this machine; nothing to prove.
  }
  const fs = new NodeWorkspaceFs(root);
  await assert.rejects(() => fs.writeFile("away/escaped.md", "no"));
});

test("listing gives one level, walking gives every file", async () => {
  const fs = new NodeWorkspaceFs(await tempDir());
  await fs.writeFile("notes/a.note.md", "a");
  await fs.writeFile("notes/deep/b.note.md", "b");
  const top = await fs.list("");
  assert.deepEqual(
    top.map((entry) => entry.path),
    ["notes"],
  );
  const walked: string[] = [];
  for await (const entry of fs.walk("")) walked.push(entry.path);
  assert.deepEqual(walked.sort(), ["notes/a.note.md", "notes/deep/b.note.md"]);
});

test("stat answers null for what is not there", async () => {
  const fs = new NodeWorkspaceFs(await tempDir());
  assert.equal(await fs.stat("missing.md"), null);
});

// ------------------------------------------------------------------- handlers

test("nothing can be read until a folder is chosen", async () => {
  const session = newVaultSession();
  assert.deepEqual(currentRoot(session), { ok: true, value: null });
  const read = await readVaultFile(session, "notes/a.md");
  assert.equal(read.ok, false);
});

test("choosing a folder makes reads and writes work", async () => {
  const session = newVaultSession();
  const root = await tempDir();
  const adopted = await adoptRoot(session, root);
  assert.deepEqual(adopted, { ok: true, value: { path: root, state: "empty" } });

  assert.deepEqual(await writeVaultFile(session, "notes/a.note.md", "Body."), {
    ok: true,
    value: null,
  });
  assert.deepEqual(await readVaultFile(session, "notes/a.note.md"), { ok: true, value: "Body." });
});

test("a dismissed dialog leaves the folder as it was", async () => {
  const session = newVaultSession();
  const root = await tempDir();
  await adoptRoot(session, root);
  const again = await adoptRoot(session, null);
  assert.deepEqual(again, { ok: true, value: { path: root, state: "empty" } });
});

test("a missing file is null, not a failure", async () => {
  const session = newVaultSession();
  await adoptRoot(session, await tempDir());
  assert.deepEqual(await readVaultFile(session, "notes/gone.md"), { ok: true, value: null });
});

test("a non-string path is refused without touching disk", async () => {
  const session = newVaultSession();
  await adoptRoot(session, await tempDir());
  assert.equal((await readVaultFile(session, 42)).ok, false);
  assert.equal((await writeVaultFile(session, "a.md", 42)).ok, false);
});

test("an escaping path is a refusal with a reason, not a crash", async () => {
  const session = newVaultSession();
  await adoptRoot(session, await tempDir());
  const result = await writeVaultFile(session, "../escaped.md", "no");
  assert.equal(result.ok, false);
});

test("forgetting the folder stops the writes but not the files", async () => {
  const session = newVaultSession();
  const root = await tempDir();
  await adoptRoot(session, root);
  await writeVaultFile(session, "a.note.md", "Body.");
  forgetRoot(session);
  assert.deepEqual(currentRoot(session), { ok: true, value: null });
  assert.equal((await readVaultFile(session, "a.note.md")).ok, false);
  // Still on disk: forgetting is the app looking away, not a delete.
  assert.equal(await new NodeWorkspaceFs(root).readText("a.note.md"), "Body.");
});

test("listing answers entries the renderer can use", async () => {
  const session = newVaultSession();
  await adoptRoot(session, await tempDir());
  await writeVaultFile(session, "notes/a.note.md", "Body.");
  const listed = await listVaultFiles(session, "notes");
  assert.equal(listed.ok, true);
  assert.deepEqual(
    listed.ok ? listed.value.map((entry) => entry.path) : [],
    ["notes/a.note.md"],
  );
});
