/**
 * What the Overleaf reader takes from a checkout. A clone is attacker-shaped
 * input: git stores symlinks, and following one reads a file outside the clone
 * (30-01). The project id goes into a clone URL, so it is held to the one shared
 * rule (30-26).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { collectTextFiles, readOverleafProject } from "../infrastructure/overleaf-git-reader";

async function tempDir(t: { after(fn: () => Promise<void>): void }, prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("text files in a checkout are collected with their relative paths", async (t) => {
  const root = await tempDir(t, "wf-overleaf-read-");
  await fs.mkdir(path.join(root, "chapters"));
  await fs.writeFile(path.join(root, "main.tex"), "\input{chapters/one}");
  await fs.writeFile(path.join(root, "chapters", "one.tex"), "\section{One}");
  await fs.writeFile(path.join(root, "figure.png"), "not text");

  const files = await collectTextFiles(root);
  assert.deepEqual(files.map((f) => f.path), ["chapters/one.tex", "main.tex"]);
});

test("a symlinked .tex in the checkout is skipped, not followed (30-01)", async (t) => {
  const outside = await tempDir(t, "wf-overleaf-secret-");
  const root = await tempDir(t, "wf-overleaf-read-");
  const secret = path.join(outside, "secret.txt");
  await fs.writeFile(secret, "SECRET");
  await fs.writeFile(path.join(root, "main.tex"), "hello");
  try {
    await fs.symlink(secret, path.join(root, "leak.tex"), "file");
  } catch (error) {
    // Windows needs admin or developer mode for file symlinks; CI (Linux) runs this.
    if ((error as NodeJS.ErrnoException).code === "EPERM") return t.skip("cannot create file symlinks here");
    throw error;
  }

  const files = await collectTextFiles(root);
  assert.deepEqual(files.map((f) => f.path), ["main.tex"]);
  assert.ok(!files.some((f) => f.content.includes("SECRET")));
});

for (const bad of ["../etc", "a/b", "abc?x=1", "", "abc def"]) {
  test(`the reader refuses project id ${JSON.stringify(bad)} before cloning (30-26)`, async () => {
    await assert.rejects(() => readOverleafProject(bad, "main.tex", "token"), /Overleaf project id is invalid/);
  });
}
