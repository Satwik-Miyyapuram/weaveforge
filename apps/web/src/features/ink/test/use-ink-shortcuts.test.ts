/**
 * The ink shortcuts stay out of fields that own their keys (21-20): a bare
 * `e` typed in a contenteditable or picked in a select is not the eraser.
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { renderHook } from "@/lib/test/react-harness";
import { useInkShortcuts, type InkShortcutsDeps } from "../ui/use-ink-shortcuts";

type Listener = (event: KeyboardEvent) => void;
const g = globalThis as { window?: unknown };
let listeners: Listener[] = [];
let savedWindow: unknown;

beforeEach(() => {
  listeners = [];
  savedWindow = g.window;
  g.window = {
    addEventListener: (type: string, fn: Listener) => {
      if (type === "keydown") listeners.push(fn);
    },
    removeEventListener: (type: string, fn: Listener) => {
      if (type === "keydown") listeners = listeners.filter((l) => l !== fn);
    },
  };
});

afterEach(() => {
  g.window = savedWindow;
});

function deps(tools: string[]): InkShortcutsDeps {
  return {
    send: () => {},
    onUndo: () => {},
    onRedo: () => {},
    setTool: (tool) => void tools.push(tool),
    onColourChange: () => {},
    selectionCount: 0,
    clearSelection: () => {},
    onDeleteSelection: () => {},
    recognise: () => {},
    onPrint: () => {},
    onExportPng: () => {},
    onExportSvg: () => {},
    scrollRef: { current: null },
    setZoom: () => {},
  };
}

function press(key: string, target: unknown) {
  const event = {
    key,
    code: "",
    target,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => {},
  } as unknown as KeyboardEvent;
  for (const l of listeners) l(event);
}

const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable });

test("a key on the page picks the tool", async () => {
  const tools: string[] = [];
  const h = await renderHook(() => useInkShortcuts(deps(tools)), undefined);
  press("e", el("DIV"));
  assert.deepEqual(tools, ["eraser"]);
  await h.unmount();
});

test("a key a field owns does not pick a tool", async () => {
  const tools: string[] = [];
  const h = await renderHook(() => useInkShortcuts(deps(tools)), undefined);
  press("e", el("INPUT"));
  press("e", el("TEXTAREA"));
  press("e", el("SELECT"));
  press("e", el("OPTION"));
  press("e", el("DIV", true));
  assert.deepEqual(tools, []);
  await h.unmount();
});

test("a key on a button still picks the tool", async () => {
  const tools: string[] = [];
  const h = await renderHook(() => useInkShortcuts(deps(tools)), undefined);
  press("p", el("BUTTON"));
  assert.equal(tools.length, 1);
  await h.unmount();
});
