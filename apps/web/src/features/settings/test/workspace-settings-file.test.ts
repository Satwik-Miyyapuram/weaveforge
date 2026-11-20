/**
 * The workspace settings file is the one place UI prefs live per workspace, so a
 * damaged or newer file must never be overwritten and external edits must show up.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { IWorkspaceFs } from "@weaveforge/core";
import {
  SETTINGS_PATH,
  WorkspaceSettingsFile,
  parseSettings,
  renderSettings,
} from "../application/workspace-settings-file";

const P = SETTINGS_PATH;

function memoryFs(files: Map<string, string>) {
  const writes: string[] = [];
  const fs = {
    stat: async (p: string) => (files.has(p) ? { path: p, kind: "file" } : null),
    readText: async (p: string) => {
      const t = files.get(p);
      if (t === undefined) throw new Error("missing");
      return t;
    },
    mkdirp: async () => {},
    writeTextIf: async (p: string, text: string, expected: string | null) => {
      if ((files.get(p) ?? null) !== expected) return false;
      files.set(p, text);
      writes.push(text);
      return true;
    },
  };
  return { writes, fs };
}

function store(files: Map<string, string>, warnings: string[], extra: Record<string, unknown> = {}) {
  const { writes, fs } = memoryFs(files);
  const s = new WorkspaceSettingsFile({
    fs: () => fs as unknown as IWorkspaceFs,
    warn: (m: string) => warnings.push(m),
    schedule: () => 0,
    cancel: () => {},
    ...extra,
  });
  return { s, writes, fs };
}

const readDoc = (files: Map<string, string>) => JSON.parse(files.get(P) ?? "null");

test("missing file: set + flush creates it with version 1", async () => {
  const files = new Map<string, string>();
  const warnings: string[] = [];
  const { s } = store(files, warnings);
  await s.load();
  assert.equal(s.get(["ink", "toolColours"]), undefined);
  assert.equal(s.state(), "missing");
  assert.equal(files.has(P), false);
  s.set(["ink", "toolColours"], { a: "#fff" });
  await s.flush();
  const doc = readDoc(files);
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.ink.toolColours, { a: "#fff" });
  assert.deepEqual(warnings, []);
});

test("missing file: load and flush with no set writes nothing", async () => {
  const files = new Map<string, string>();
  const { s, writes } = store(files, []);
  await s.load();
  await s.flush();
  assert.equal(files.has(P), false);
  assert.equal(writes.length, 0);
});

test("round trip: a new store on the same files reads the saved value", async () => {
  const files = new Map<string, string>();
  const a = store(files, []);
  a.s.set(["ink", "toolColours"], { pen: "#123456" });
  await a.s.flush();
  const b = store(files, []);
  await b.s.load();
  assert.deepEqual(b.s.get(["ink", "toolColours"]), { pen: "#123456" });
});

test("stable output: keys sorted at every depth, 2-space indent, trailing newline", async () => {
  const text = renderSettings({ zeta: 1, ink: { b: [{ y: 1, x: 2 }], a: null }, version: 9 } as never);
  assert.equal(
    text,
    '{\n  "ink": {\n    "a": null,\n    "b": [\n      {\n        "x": 2,\n        "y": 1\n      }\n    ]\n  },\n  "version": 1,\n  "zeta": 1\n}\n',
  );
});

test("unknown keys are preserved across a write", async () => {
  const files = new Map<string, string>([
    [P, '{"version":1,"zzz":{"keep":true},"ink":{"other":1}}'],
  ]);
  const { s } = store(files, []);
  await s.load();
  s.set(["ink", "toolColours"], { x: 1 });
  await s.flush();
  const doc = readDoc(files);
  assert.equal(doc.zzz.keep, true);
  assert.equal(doc.ink.other, 1);
  assert.deepEqual(doc.ink.toolColours, { x: 1 });
});

test("corrupt file: locked, defaults used, never written", async () => {
  const files = new Map<string, string>([[P, "{not json"]]);
  const warnings: string[] = [];
  const { s, writes } = store(files, warnings);
  await s.load();
  assert.equal(s.state(), "locked");
  assert.equal(s.get(["ink", "toolColours"]), undefined);
  s.set(["ink", "toolColours"], { x: 1 });
  await s.flush();
  assert.equal(files.get(P), "{not json");
  assert.equal(writes.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /settings\.json/);
});

test("newer version file: locked, untouched, warned", async () => {
  const original = '{"version":2,"ink":{}}';
  const files = new Map<string, string>([[P, original]]);
  const warnings: string[] = [];
  const { s, writes } = store(files, warnings);
  await s.load();
  assert.equal(s.state(), "locked");
  s.set(["ink", "toolColours"], { x: 1 });
  await s.flush();
  assert.equal(files.get(P), original);
  assert.equal(writes.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /settings\.json/);
});

test("external edit is picked up by a second load and notifies", async () => {
  const files = new Map<string, string>([[P, '{"version":1,"ink":{"toolColours":"x"}}']]);
  const { s } = store(files, []);
  await s.load();
  let calls = 0;
  s.subscribe(() => calls++);
  files.set(P, '{"version":1,"ink":{"toolColours":"y"}}');
  await s.load();
  assert.equal(s.get(["ink", "toolColours"]), "y");
  assert.equal(calls, 1);
});

test("own write echo: load after flush does not notify", async () => {
  const files = new Map<string, string>();
  const { s } = store(files, []);
  s.set(["ink", "toolColours"], { x: 1 });
  await s.flush();
  let calls = 0;
  s.subscribe(() => calls++);
  await s.load();
  assert.equal(calls, 0);
});

test("concurrent write conflict: disk changes are merged with pending set", async () => {
  const files = new Map<string, string>([[P, '{"version":1,"ink":{}}']]);
  const warnings: string[] = [];
  const { s } = store(files, warnings);
  await s.load();
  files.set(P, '{"version":1,"ink":{},"other":{"a":1}}');
  s.set(["ink", "toolColours"], "x");
  await s.flush();
  const doc = readDoc(files);
  assert.equal(doc.other.a, 1);
  assert.equal(doc.ink.toolColours, "x");
  assert.deepEqual(warnings, []);
});

test("conflict that keeps changing: one warning, file unchanged, pending kept", async () => {
  const files = new Map<string, string>([[P, '{"version":1}']]);
  const warnings: string[] = [];
  const { fs } = store(files, warnings);
  const alwaysFalse = { ...fs, writeTextIf: async () => false };
  const bad = new WorkspaceSettingsFile({
    fs: () => alwaysFalse as unknown as IWorkspaceFs,
    warn: (m: string) => warnings.push(m),
    schedule: () => 0,
    cancel: () => {},
  });
  await bad.load();
  bad.set(["ink", "toolColours"], "kept");
  await bad.flush();
  assert.equal(files.get(P), '{"version":1}');
  assert.equal(warnings.filter((w) => /kept changing/.test(w)).length, 1);
  await bad.flush();
  assert.equal(warnings.filter((w) => /kept changing/.test(w)).length, 2);
  // pending survives: a working fs writes it on the next flush
  const good = new WorkspaceSettingsFile({
    fs: () => fs as unknown as IWorkspaceFs,
    warn: (m: string) => warnings.push(m),
    schedule: () => 0,
    cancel: () => {},
  });
  await good.load();
  good.set(["ink", "toolColours"], "later");
  await good.flush();
  assert.equal(readDoc(files).ink.toolColours, "later");
});

test("debounce: second set cancels the first timer and one flush writes once", async () => {
  const files = new Map<string, string>();
  const scheduled: unknown[] = [];
  const cancelled: unknown[] = [];
  let n = 0;
  const { s, writes } = store(files, [], {
    schedule: () => {
      const h = ++n;
      scheduled.push(h);
      return h;
    },
    cancel: (h: unknown) => {
      cancelled.push(h);
    },
  });
  s.set(["a"], 1);
  s.set(["a"], 2);
  assert.deepEqual(cancelled, [1]);
  assert.equal(scheduled.length, 2);
  await s.flush();
  assert.equal(writes.length, 1);
  assert.equal(readDoc(files).a, 2);
});

// After two refused writes the pending edit must not wait for the next change: a retry is
// scheduled, each refusal backs off longer, and the first retry that succeeds saves it.
test("a refused save retries on a growing backoff timer until it lands", async () => {
  const files = new Map<string, string>([[P, '{"version":1}']]);
  const warnings: string[] = [];
  const { fs } = store(files, warnings);
  let refuse = true;
  const realWriteTextIf = fs.writeTextIf!.bind(fs);
  const flaky = { ...fs, writeTextIf: (p: string, t: string, e: string | null) => (refuse ? Promise.resolve(false) : realWriteTextIf(p, t, e)) };
  // Live timers only: cancel removes a handle, as a real clearTimeout would.
  const live = new Map<number, { fn: () => void; ms: number }>();
  let next = 0;
  const s = new WorkspaceSettingsFile({
    fs: () => flaky as unknown as IWorkspaceFs,
    warn: (m: string) => warnings.push(m),
    delayMs: 100,
    schedule: (fn: () => void, ms: number) => {
      live.set(++next, { fn, ms });
      return next;
    },
    cancel: (h: unknown) => {
      live.delete(h as number);
    },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const fireNext = async () => {
    const [id, timer] = [...live][0] ?? [];
    if (id === undefined || !timer) throw new Error("no retry scheduled");
    live.delete(id);
    timer.fn();
    await settle();
    return timer.ms;
  };

  await s.load();
  s.set(["ink", "toolColours"], "kept");
  await s.flush();
  const first = [...live.values()].map((t) => t.ms);
  assert.equal(live.size, 1, "the refused save schedules a retry");

  const firstDelay = await fireNext();
  const secondDelay = [...live.values()].map((t) => t.ms)[0] ?? 0;
  assert.equal(live.size, 1, "the refused retry schedules another");
  assert.ok(secondDelay > firstDelay, `backoff grows: ${first} then ${secondDelay}`);
  assert.equal(files.get(P), '{"version":1}', "nothing was written while refused");

  refuse = false;
  await fireNext();
  assert.equal(readDoc(files).ink.toolColours, "kept", "the retry that succeeds saves the edit");
  assert.equal(live.size, 0, "no retry once saved");
});

test("no folder: set works in memory, flush is quiet, no schedule", async () => {
  const scheduleCalls: number[] = [];
  const s = new WorkspaceSettingsFile({
    fs: () => null,
    warn: () => {},
    schedule: () => {
      scheduleCalls.push(1);
      return 0;
    },
    cancel: () => {},
  });
  s.set(["ink", "toolColours"], "mem");
  assert.equal(s.get(["ink", "toolColours"]), "mem");
  await s.flush();
  assert.equal(scheduleCalls.length, 0);
});

test("no writeTextIf: checked fallback writes, and an external change is merged", async () => {
  const files = new Map<string, string>([[P, '{"version":1,"ink":{}}']]);
  const warnings: string[] = [];
  const { fs } = memoryFs(files);
  const noCas = {
    stat: fs.stat,
    readText: fs.readText,
    mkdirp: fs.mkdirp,
    writeFile: async (p: string, text: string) => {
      files.set(p, text);
    },
  };
  const s = new WorkspaceSettingsFile({
    fs: () => noCas as unknown as IWorkspaceFs,
    warn: (m: string) => warnings.push(m),
    schedule: () => 0,
    cancel: () => {},
  });
  await s.load();
  files.set(P, '{"version":1,"ink":{},"other":{"a":1}}');
  s.set(["ink", "toolColours"], "x");
  await s.flush();
  const doc = readDoc(files);
  assert.equal(doc.other.a, 1);
  assert.equal(doc.ink.toolColours, "x");
  assert.deepEqual(warnings, []);
});

test("parseSettings: version rules and corrupt shapes", () => {
  assert.equal(parseSettings('{"ink":{}}').ok, true);
  assert.deepEqual(parseSettings('{"version":1}'), { ok: true, doc: { version: 1 } });
  assert.deepEqual(parseSettings('{"version":"1"}'), { ok: false, reason: "corrupt" });
  assert.deepEqual(parseSettings('{"version":1.5}'), { ok: false, reason: "corrupt" });
  assert.deepEqual(parseSettings('{"version":2}'), { ok: false, reason: "newer" });
  assert.deepEqual(parseSettings("[1]"), { ok: false, reason: "corrupt" });
  assert.deepEqual(parseSettings("null"), { ok: false, reason: "corrupt" });
});
