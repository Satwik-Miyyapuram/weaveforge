/**
 * Edits that a close could not write (retries exhausted, file locked, folder gone) are parked
 * in `.weaveforge/settings.pending.json`, merged on the next load, and the sidecar is removed
 * once a write lands. Credentials are never parked.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { IWorkspaceFs } from "@weaveforge/core";
import { WorkspaceSettingsFile, SETTINGS_PATH, renderSettings } from "../application/workspace-settings-file";

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
  assert.equal(warnings.filter((m) => m.startsWith("no workspace folder is open")).length, 1, "warns exactly once while no folder is open");
});

test("an edit made while the launch restore is still opening the folder does not warn", async () => {
  const warnings: string[] = [];
  const files = new Map<string, string>();
  const fs = memoryFs(files, { on: false });
  let folder: IWorkspaceFs | null = null;
  let restore!: () => void;
  const restored = new Promise<void>((resolve) => (restore = resolve));
  let scheduled = 0;
  const file = new WorkspaceSettingsFile({
    fs: () => folder,
    restored: () => restored,
    warn: (m: string) => warnings.push(m),
    schedule: () => ++scheduled,
    cancel: () => {},
  });
  file.set(["ui", "zoom"], 2);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(warnings, [], "no warning before the restore has answered");
  folder = fs as unknown as IWorkspaceFs;
  restore();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(warnings, [], "the folder came back, so nothing to warn about");
  assert.ok(scheduled > 0, "the waiting edit is scheduled for writing");
});

test("an edit with no folder after the launch restore warns once", async () => {
  const warnings: string[] = [];
  const file = new WorkspaceSettingsFile({
    fs: () => null,
    restored: () => Promise.resolve(),
    warn: (m: string) => warnings.push(m),
    schedule: () => 0,
    cancel: () => {},
  });
  file.set(["ui", "zoom"], 2);
  file.set(["ui", "zoom"], 3);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(warnings.filter((m) => m.startsWith("no workspace folder is open")).length, 1);
});

test("closing with no folder open names the unsaved keys", async () => {
  const warnings: string[] = [];
  const file = new WorkspaceSettingsFile({
    fs: () => null,
    warn: (m: string) => warnings.push(m),
    schedule: () => 0,
    cancel: () => {},
  });
  await file.load();
  file.set(["ink", "toolColours"], { a: "#fff" });
  file.set(["ui", "zoom"], 2);
  await file.close();
  assert.ok(
    warnings.some((m) => m.includes("ink.toolColours") && m.includes("ui.zoom")),
    `close must name the unsaved keys, got: ${JSON.stringify(warnings)}`,
  );
});

test("dirty() is true while an edit waits, even with no folder open", () => {
  const file = new WorkspaceSettingsFile({
    fs: () => null,
    warn: () => {},
    schedule: () => 0,
    cancel: () => {},
  });
  assert.equal(file.dirty(), false);
  file.set(["ui", "zoom"], 2);
  assert.equal(file.dirty(), true);
});

test("reopening an unchanged file writes the edits made while no folder was open", async () => {
  const files = new Map<string, string>([[SETTINGS_PATH, renderSettings({})]]);
  const scheduled: Array<() => void> = [];
  let current: ReturnType<typeof memoryFs> | null = memoryFs(files, { on: false });
  const file = new WorkspaceSettingsFile({
    fs: () => current as unknown as IWorkspaceFs | null,
    warn: () => {},
    schedule: (fn: () => void) => {
      scheduled.push(fn);
      return 0;
    },
    cancel: () => {},
  });
  await file.load();
  current = null;
  file.set(["ui", "zoom"], 2);
  await file.close();
  current = memoryFs(files, { on: false });
  await file.load();
  assert.ok(scheduled.length > 0, "load must schedule the pending edit even when the disk text is unchanged");
  const last = scheduled[scheduled.length - 1];
  assert.ok(last);
  last();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(JSON.parse(files.get(SETTINGS_PATH) ?? "{}").ui.zoom, 2);
});
test("the no-folder warning repeats while an edit waits, and stops once a folder opens", async () => {
  const files = new Map<string, string>();
  const refuse = { on: false };
  const warnings: string[] = [];
  const live = new Map<number, () => void>();
  let nextId = 0;
  let folder = false;
  const fs = memoryFs(files, refuse);
  const settings = new WorkspaceSettingsFile({
    fs: () => (folder ? (fs as unknown as IWorkspaceFs) : null),
    warn: (m: string) => warnings.push(m),
    schedule: (fn: () => void) => {
      const id = ++nextId;
      live.set(id, fn);
      return id;
    },
    cancel: (h: unknown) => {
      live.delete(h as number);
    },
  });
  const reminders = () =>
    warnings.filter((m) => m.startsWith("settings still not saved") && m.includes("ink.width")).length;
  const runDue = () => {
    const due = [...live.values()];
    live.clear();
    for (const fn of due) fn();
  };

  settings.set(["ink", "width"], 3);
  assert.equal(settings.dirty(), true);
  runDue();
  assert.equal(reminders(), 1, "the first reminder fires while the edit still waits with no folder");
  runDue();
  assert.equal(reminders(), 2, "it keeps repeating while the edit waits");

  folder = true;
  await settings.load();
  runDue();
  assert.equal(reminders(), 2, "opening a folder stops the reminder");
  assert.equal(live.size, 0, "no reminder stays scheduled after a folder opens");
});

test("the no-folder reminder names the unsaved keys", () => {
  const warnings: string[] = [];
  const live = new Map<number, () => void>();
  let nextId = 0;
  const settings = new WorkspaceSettingsFile({
    fs: () => null,
    warn: (m: string) => warnings.push(m),
    schedule: (fn: () => void) => {
      const id = ++nextId;
      live.set(id, fn);
      return id;
    },
    cancel: (h: unknown) => {
      live.delete(h as number);
    },
  });
  settings.set(["ink", "width"], 3);
  const due = [...live.values()];
  live.clear();
  for (const fn of due) fn();
  const reminder = warnings.find((m) => m.startsWith("settings still not saved")) ?? "";
  assert.ok(reminder.includes("ink.width"), `reminder names the key, got: ${reminder}`);
  assert.ok(!reminder.includes("\\."), "no literal escape in the message");
});

test("close() stops the no-folder reminder", async () => {
  const warnings: string[] = [];
  const live = new Map<number, () => void>();
  let nextId = 0;
  const settings = new WorkspaceSettingsFile({
    fs: () => null,
    warn: (m: string) => warnings.push(m),
    schedule: (fn: () => void) => {
      const id = ++nextId;
      live.set(id, fn);
      return id;
    },
    cancel: (h: unknown) => {
      live.delete(h as number);
    },
  });
  settings.set(["ink", "width"], 3);
  await settings.close();
  assert.equal(live.size, 0, "no reminder stays scheduled after close()");
});

test("park never writes a credential, even nested under a non-secret key or named with a dash", async () => {
  const files = new Map<string, string>();
  const refuse = { on: true };
  const warnings: string[] = [];
  const exiting = open(files, refuse, warnings);
  await exiting.load();
  exiting.set(["sync"], { server: "https://sync.example", authToken: "NESTED-SECRET-VALUE" });
  exiting.set(["ink", "api-key"], "DASH-SECRET-VALUE");
  await exiting.close();
  const parked = files.get(PARKED) ?? "";
  assert.ok(parked.includes("https://sync.example"), "the non-secret sibling is still parked");
  assert.ok(!parked.includes("NESTED-SECRET-VALUE"), "a token nested inside a parked value is stripped");
  assert.ok(!parked.includes("DASH-SECRET-VALUE"), "a dashed secret key is not parked");
});
