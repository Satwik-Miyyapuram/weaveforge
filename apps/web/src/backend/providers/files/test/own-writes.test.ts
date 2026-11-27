/**
 * Own-write memory: the folder watcher must tell the app's own write echoing back
 * from an outside edit, so what the app wrote is remembered per path.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { forgetOwnWrites, isOwnWrite, moveOwnWrite, recordOwnWrite } from "../own-writes";
import { DesktopWorkspaceFs } from "@/features/workspace/infrastructure/parts";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

test("an own text write matches only its exact text at its path", () => {
  forgetOwnWrites();
  recordOwnWrite("a.md", "x");
  assert.equal(isOwnWrite("a.md", "x"), true);
  assert.equal(isOwnWrite("a.md", "y"), false);
  assert.equal(isOwnWrite("b.md", "x"), false);
});

test("a later own write at the same path replaces the earlier one", () => {
  forgetOwnWrites();
  recordOwnWrite("a.md", "x");
  recordOwnWrite("a.md", "y");
  assert.equal(isOwnWrite("a.md", "x"), false);
  assert.equal(isOwnWrite("a.md", "y"), true);
});

test("a binary own write is matched by path alone", () => {
  forgetOwnWrites();
  recordOwnWrite("p.pdf", new Uint8Array([1, 2]));
  assert.equal(isOwnWrite("p.pdf", "anything"), true);
});

test("forgetOwnWrites clears everything remembered", () => {
  forgetOwnWrites();
  recordOwnWrite("a.md", "y");
  forgetOwnWrites();
  assert.equal(isOwnWrite("a.md", "y"), false);
});

test("the memory is bounded: the oldest path is forgotten first", () => {
  forgetOwnWrites();
  for (let i = 0; i < 2100; i++) recordOwnWrite(`f-${i}.md`, `t-${i}`);
  assert.equal(isOwnWrite("f-0.md", "t-0"), false);
  assert.equal(isOwnWrite("f-2099.md", "t-2099"), true);
});

test("a move carries the record to the new path", () => {
  forgetOwnWrites();
  recordOwnWrite("a.md", "x");
  moveOwnWrite("a.md", "b.md");
  assert.equal(isOwnWrite("b.md", "x"), true);
  assert.equal(isOwnWrite("a.md", "x"), false);
});

test("a move from an unknown path leaves the destination unknown", () => {
  forgetOwnWrites();
  recordOwnWrite("b.md", "x");
  moveOwnWrite("zz.md", "b.md");
  assert.equal(isOwnWrite("b.md", "x"), false);
});

/** A bridge over an in-memory map, standing in for the desktop shell. */
function desktopFs() {
  const files = new Map<string, string>();
  const bridge = {
    async readVaultFile(p: string) {
      return files.get(p) ?? null;
    },
    async writeVaultFile(p: string, t: string) {
      files.set(p, t);
    },
    async writeVaultBytes(p: string) {
      files.set(p, "<bin>");
    },
    async writeVaultFileIf(p: string, t: string, e: string | null) {
      if ((files.get(p) ?? null) !== e) return false;
      files.set(p, t);
      return true;
    },
    async renameVaultFile(a: string, b: string) {
      files.set(b, files.get(a)!);
      files.delete(a);
    },
    async removeVaultFile(p: string) {
      files.delete(p);
    },
    async listVaultFiles() {
      return [];
    },
    async statVaultFile() {
      return null;
    },
    async readVaultBytes(p: string) {
      return files.has(p) ? new TextEncoder().encode(files.get(p)!) : null;
    },
  };
  return new DesktopWorkspaceFs(bridge as unknown as ConstructorParameters<typeof DesktopWorkspaceFs>[0]);
}

test("a desktop writeFile is remembered at its path", async () => {
  forgetOwnWrites();
  await desktopFs().writeFile("notes/a.md", "hi");
  assert.equal(isOwnWrite("notes/a.md", "hi"), true);
});

test("a desktop writeTextIf is remembered only when it writes", async () => {
  forgetOwnWrites();
  const fs = desktopFs();
  assert.equal(await fs.writeTextIf("notes/a.md", "v2", null), true);
  assert.equal(isOwnWrite("notes/a.md", "v2"), true);
  assert.equal(await fs.writeTextIf("notes/a.md", "v3", "WRONG"), false);
  assert.equal(isOwnWrite("notes/a.md", "v3"), false);
});

test("a desktop rename moves the record to the new path", async () => {
  forgetOwnWrites();
  const fs = desktopFs();
  await fs.writeFile("notes/t.tmp", "x");
  await fs.rename("notes/t.tmp", "notes/a.md");
  assert.equal(isOwnWrite("notes/a.md", "x"), true);
});

test("a desktop binary write is matched by path alone", async () => {
  forgetOwnWrites();
  await desktopFs().writeFile("p.pdf", new Uint8Array([1]));
  assert.equal(isOwnWrite("p.pdf", "whatever"), true);
});
