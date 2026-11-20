import assert from "node:assert/strict";
import test from "node:test";

import type { IWorkspaceFs } from "@weaveforge/core";

import { bindWorkspaceSettingsFolder, workspaceSettings } from "@/features/settings/application/workspace-settings";

import {
  DEFAULT_TOOL_COLOURS,
  readToolColours,
  resetToolColoursCacheForTests,
  setToolColour,
  subscribeToolColours,
  type ToolColours,
} from "../ui/use-tool-colours";

const TOOL_COLOUR_KEY = "weaveforge.ink.tool-colours";
const P = ".weaveforge/settings.json";

/** An in-memory localStorage, so the store is read and written as the app does. */
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

/** An in-memory workspace folder over one Map of path to text. */
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

function fullColours(pen: string): ToolColours {
  return {
    ...DEFAULT_TOOL_COLOURS,
    pen: { ...DEFAULT_TOOL_COLOURS.pen, colour: pen as ToolColours["pen"]["colour"] },
  };
}

test("the workspace file's colours win over this device's", async () => {
  const store = installStorage();
  store.set(TOOL_COLOUR_KEY, JSON.stringify(fullColours("red")));
  const files = new Map([[P, JSON.stringify({ version: 1, ink: { toolColours: fullColours("blue") } })]]);
  await open(files);

  assert.equal(readToolColours().pen.colour, "blue");
  await workspaceSettings.flush();
});

test("a colour change is written to the workspace file", async () => {
  installStorage();
  const files = new Map<string, string>();
  await open(files);

  setToolColour("pen", "green");
  await workspaceSettings.flush();

  const written = JSON.parse(files.get(P) ?? "null");
  assert.equal(written.ink.toolColours.pen.colour, "green");
  assert.equal(written.version, 1);
});

test("an edit to the file by hand shows without a restart", async () => {
  installStorage();
  const files = new Map([[P, JSON.stringify({ version: 1, ink: { toolColours: fullColours("blue") } })]]);
  await open(files);
  assert.equal(readToolColours().pen.colour, "blue");

  const calls: number[] = [];
  const stop = subscribeToolColours(() => calls.push(1));
  files.set(P, JSON.stringify({ version: 1, ink: { toolColours: fullColours("purple") } }));
  await workspaceSettings.load();

  assert.ok(calls.length >= 1);
  assert.equal(readToolColours().pen.colour, "purple");
  stop();
  await workspaceSettings.flush();
});

test("no value in the file: this device's colours are used", async () => {
  const store = installStorage();
  store.set(TOOL_COLOUR_KEY, JSON.stringify(fullColours("red")));
  const files = new Map([[P, JSON.stringify({ version: 1 })]]);
  await open(files);

  assert.equal(readToolColours().pen.colour, "red");
  assert.equal(files.get(P), JSON.stringify({ version: 1 }));
  await workspaceSettings.flush();
});

test("our own write does not drop the cache", async () => {
  installStorage();
  const files = new Map<string, string>();
  await open(files);

  setToolColour("pen", "green");
  const a = readToolColours();
  const b = readToolColours();
  assert.equal(a, b);
  await workspaceSettings.flush();
});
