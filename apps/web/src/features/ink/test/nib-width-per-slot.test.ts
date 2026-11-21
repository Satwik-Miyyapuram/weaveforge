import assert from "node:assert/strict";
import test from "node:test";

import type { IWorkspaceFs } from "@weaveforge/core";

import { bindWorkspaceSettingsFolder, workspaceSettings } from "@/features/settings/application/workspace-settings";

import {
  DEFAULT_TOOL_COLOURS,
  readToolColours,
  resetToolColoursCacheForTests,
  setToolColour,
  setToolQuickWidth,
  setWidthForColour,
  slotWidth,
  widthInForce,
} from "../ui/use-tool-colours";

const P = ".weaveforge/settings.json";
const LEGACY_PEN_PREFS_KEY = "weaveforge.reader.pen";

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  return store;
}

function memoryFs(files: Map<string, string>) {
  return {
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
      return true;
    },
  };
}

async function open(files: Map<string, string>) {
  bindWorkspaceSettingsFolder(() => memoryFs(files) as unknown as IWorkspaceFs);
  await workspaceSettings.load();
  resetToolColoursCacheForTests();
}

const [first, second] = DEFAULT_TOOL_COLOURS.pen.quick;

test("two pen slots keep different widths, and picking a colour gives back its width", async () => {
  installStorage();
  await open(new Map());

  setToolQuickWidth("pen", 0, 1);
  setToolQuickWidth("pen", 1, 7);

  const pen = readToolColours().pen;
  assert.equal(slotWidth(pen, first!), 1);
  assert.equal(slotWidth(pen, second!), 7);
  await workspaceSettings.flush();
});

test("a slot width is written to the workspace file and survives a restart", async () => {
  installStorage();
  const files = new Map<string, string>();
  await open(files);
  setToolQuickWidth("highlighter", 2, 90);
  await workspaceSettings.flush();

  installStorage();
  await open(files);
  const highlighter = readToolColours().highlighter;
  assert.equal(slotWidth(highlighter, highlighter.quick[2]!), 90);
});

test("a width the tool has no nib for is not saved", async () => {
  installStorage();
  await open(new Map());

  setToolQuickWidth("pen", 0, 60);
  setToolQuickWidth("highlighter", 0, 3);

  const colours = readToolColours();
  assert.equal(slotWidth(colours.pen, first!), null);
  assert.equal(slotWidth(colours.highlighter, colours.highlighter.quick[0]!), null);
  await workspaceSettings.flush();
});

test("with no width set, a slot has none, so each surface keeps its own default", async () => {
  installStorage();
  await open(new Map());
  const pen = readToolColours().pen;
  for (const colour of pen.quick) assert.equal(slotWidth(pen, colour), null);
  await workspaceSettings.flush();
});

test("a colour outside the quick slots has no width", async () => {
  installStorage();
  await open(new Map());
  setToolQuickWidth("pen", 0, 5);
  const pen = readToolColours().pen;
  const outside = (["purple", "grey", "orange", "pink", "yellow"] as const).find((c) => !pen.quick.includes(c))!;
  assert.equal(slotWidth(pen, outside), null);
  await workspaceSettings.flush();
});

test("the reader's old global widths move into every pen and highlighter slot", async () => {
  const store = installStorage();
  store.set(LEGACY_PEN_PREFS_KEY, JSON.stringify({ tool: "pen", width: 7, highlighterWidth: 30 }));
  await open(new Map());

  const colours = readToolColours();
  for (const c of colours.pen.quick) assert.equal(slotWidth(colours.pen, c), 7);
  for (const c of colours.highlighter.quick) assert.equal(slotWidth(colours.highlighter, c), 30);
  await workspaceSettings.flush();
});

test("the old global width moves over once: slot widths already saved are left alone", async () => {
  const store = installStorage();
  store.set(LEGACY_PEN_PREFS_KEY, JSON.stringify({ width: 7 }));
  const pen = { ...DEFAULT_TOOL_COLOURS.pen, widths: [1, null, null, null, null] };
  const files = new Map([[P, JSON.stringify({ version: 1, ink: { toolColours: { ...DEFAULT_TOOL_COLOURS, pen } } })]]);
  await open(files);

  const colours = readToolColours();
  assert.equal(slotWidth(colours.pen, first!), 1);
  assert.equal(slotWidth(colours.pen, second!), null);
  await workspaceSettings.flush();
});

test("the migrated widths are saved, so a later reader width change does not move them", async () => {
  const store = installStorage();
  store.set(LEGACY_PEN_PREFS_KEY, JSON.stringify({ width: 7 }));
  const files = new Map<string, string>();
  await open(files);
  readToolColours();
  await workspaceSettings.flush();

  store.set(LEGACY_PEN_PREFS_KEY, JSON.stringify({ width: 1 }));
  await open(files);
  assert.equal(slotWidth(readToolColours().pen, first!), 7);
});

test("a hand edit to the file's slot width is picked up live", async () => {
  installStorage();
  const files = new Map<string, string>();
  await open(files);
  setToolQuickWidth("pen", 0, 3);
  await workspaceSettings.flush();

  const doc = JSON.parse(files.get(P)!);
  doc.ink.toolColours.pen.widths[0] = 5;
  files.set(P, JSON.stringify(doc));
  await workspaceSettings.load();

  assert.equal(slotWidth(readToolColours().pen, first!), 5);
});

test("the width in force is the current colour's slot width, else the surface's own", async () => {
  installStorage();
  await open(new Map());
  assert.equal(widthInForce(readToolColours().pen, 3), 3);
  setToolQuickWidth("pen", 0, 7);
  setToolColour("pen", first!);
  assert.equal(widthInForce(readToolColours().pen, 3), 7);
  setToolColour("pen", second!);
  assert.equal(widthInForce(readToolColours().pen, 3), 3);
  await workspaceSettings.flush();
});

test("choosing a width saves it on the current colour's slot only", async () => {
  installStorage();
  await open(new Map());
  setToolColour("pen", second!);
  setWidthForColour("pen", 5);
  const pen = readToolColours().pen;
  assert.equal(slotWidth(pen, second!), 5);
  assert.equal(slotWidth(pen, first!), null);
  await workspaceSettings.flush();
});

test("choosing a width with a colour outside the quick slots saves nothing", async () => {
  installStorage();
  await open(new Map());
  const outside = (["purple", "grey", "orange", "pink", "yellow"] as const).find(
    (c) => !readToolColours().pen.quick.includes(c),
  )!;
  setToolColour("pen", outside);
  setWidthForColour("pen", 5);
  assert.deepEqual(readToolColours().pen.widths, [null, null, null, null, null]);
  await workspaceSettings.flush();
});
