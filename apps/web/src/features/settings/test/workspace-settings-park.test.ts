/**
 * Edits that a close could not write (retries exhausted, file locked, folder gone) are parked
 * in `.weaveforge/settings.pending.json`, merged on the next load, and the sidecar is removed
 * once a write lands. Credentials are never parked.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { IWorkspaceFs } from "@weaveforge/core";
import { WorkspaceSettingsFile, SETTINGS_PATH } from "../application/workspace-settings-file";

const PARKED = ".weaveforge/settings.pending.json";

/** An fs over one map. `refuse` makes every compare-and-swap write lose, as a busy file does. */
function memoryFs(files: Map<string, string>, refuse: { on: boolean }) {
  return {
    stat: async (p: string) => (files.has(p) ? { path: p, kind: "file" } : null),
    readText: async (p: string) => {
      const t = files.get(p);
      if (t === undefined) throw new Error("missing");
      return t;
    },
    mkdirp: async () => {},
    writeFile: async (p: string, text: string) => {
      files.set(p, text);
    },
    remove: async (p: string) => {
      files.delete(p);
    },
    writeTextIf: async (p: string, text: string, expected: string | null) => {
      if (refuse.on || (files.get(p) ?? null) !== expected) return false;
      files.set(p, text);
      return true;
    },
  };
}

function open(files: Map<string, string>, refuse: { on: boolean }, warnings: string[]) {
  const fs = memoryFs(files, refuse);
  return new WorkspaceSettingsFile({
    fs: () => fs as unknown as IWorkspaceFs,
    warn: (m: string) => warnings.push(m),
    schedule: () => 0,
    cancel: () => {},
  });
}

test("an edit that could not be saved on close is parked, then merged and cleared on the next load", async () => {
  const files = new Map<string, string>();
  const refuse = { on: true };
  const warnings: string[] = [];

  const exiting = open(files, refuse, warnings);
  await exiting.load();
  exiting.set(["ink", "toolColours"], { a: "#fff" });
  await exiting.close();
  assert.equal(files.has(SETTINGS_PATH), false, "the settings file was not written while the save kept losing");
  assert.deepEqual(JSON.parse(files.get(PARKED) ?? "[]"), [{ key: ["ink", "toolColours"], value: { a: "#fff" } }]);

  // Next launch: the file is writable again and the parked edit is merged, then the sidecar goes.
  refuse.on = false;
  const next = open(files, refuse, warnings);
  await next.load();
  assert.deepEqual(next.get(["ink", "toolColours"]), { a: "#fff" });
  await next.flush();
  assert.deepEqual(JSON.parse(files.get(SETTINGS_PATH) ?? "null").ink.toolColours, { a: "#fff" });
  assert.equal(files.has(PARKED), false, "the sidecar is removed after the write lands");
});

test("a credential is never parked", async () => {
  const files = new Map<string, string>();
  const refuse = { on: true };
  const exiting = open(files, refuse, []);
  await exiting.load();
  exiting.set(["integrations", "sync:p1:github", "token"], "SECRET-gh");
  await exiting.close();
  assert.equal(files.has(PARKED), false);
});

test("with no workspace folder open, edits stay in memory, warn once, and close() resolves", async () => {
  const warnings: string[] = [];
  const file = new WorkspaceSettingsFile({
    fs: () => null,
    warn: (m: string) => warnings.push(m),
    schedule: () => 0,
    cancel: () => {},
  });
  await file.load();
  file.set(["ink", "toolColours"], { a: "#fff" });
  file.set(["ink", "toolColours"], { a: "#000" });
  file.set(["ui", "zoom"], 2);
  await assert.doesNotReject(file.close());
  assert.deepEqual(file.get(["ink", "toolColours"]), { a: "#000" }, "the edit is kept in memory");
  assert.equal(warnings.length, 1, "warns exactly once while no folder is open");
});
