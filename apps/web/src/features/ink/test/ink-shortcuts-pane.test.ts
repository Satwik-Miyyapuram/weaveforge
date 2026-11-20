/**
 * Split panes keep every note mounted, so each ink host has its own window
 * keydown listener. Ctrl+Shift+P must print only the note in the focused,
 * shown pane — not every mounted one.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";

import { loadTestCore } from "@/lib/test/load-test-core";
import { renderHook } from "@/lib/test/react-harness";
import { PaneFocusedContext } from "@/lib/hooks/use-pane-focused";

import { useInkShortcuts, type InkShortcutsDeps } from "../ui/use-ink-shortcuts";

before(async () => {
  await loadTestCore();
});

// Node has no window; a bare EventTarget is enough for a keydown listener.
const target = new EventTarget();
(globalThis as { window?: unknown }).window ??= target;
const win = (globalThis as unknown as { window: EventTarget }).window;

function deps(onPrint: () => void): InkShortcutsDeps {
  const noop = () => {};
  return {
    send: noop,
    onUndo: noop,
    onRedo: noop,
    setTool: noop,
    onColourChange: noop,
    selectionCount: 0,
    clearSelection: noop,
    onDeleteSelection: noop,
    recognise: noop,
    onPrint,
    onExportPng: noop,
    onExportSvg: noop,
    scrollRef: { current: null },
    setZoom: noop,
  };
}

function pressPrint() {
  const event = new Event("keydown") as Event & Record<string, unknown>;
  Object.assign(event, { key: "P", code: "KeyP", ctrlKey: true, shiftKey: true, metaKey: false });
  event.preventDefault = () => {};
  win.dispatchEvent(event);
}

async function mount(focused: boolean, onPrint: () => void) {
  const stable = deps(onPrint);
  return renderHook(() => useInkShortcuts(stable), undefined, {
    wrapper: (children: ReactNode) => createElement(PaneFocusedContext.Provider, { value: focused }, children),
  });
}

test("split: Ctrl+Shift+P prints only the focused pane's note, once", async () => {
  const printed: string[] = [];
  const left = await mount(true, () => printed.push("left"));
  const right = await mount(false, () => printed.push("right"));
  pressPrint();
  assert.deepEqual(printed, ["left"]);
  await left.unmount();
  await right.unmount();
});

test("split: a hidden tab in the focused pane does not print", async () => {
  const printed: string[] = [];
  const shown = await mount(true, () => printed.push("shown"));
  const hiddenTab = await mount(false, () => printed.push("hidden"));
  pressPrint();
  assert.deepEqual(printed, ["shown"]);
  await shown.unmount();
  await hiddenTab.unmount();
});

test("no pane around it (default): the shortcut still prints", async () => {
  const printed: string[] = [];
  const stable = deps(() => printed.push("solo"));
  const solo = await renderHook(() => useInkShortcuts(stable), undefined);
  pressPrint();
  assert.deepEqual(printed, ["solo"]);
  await solo.unmount();
});

test("pane view marks only the shown document of the focused pane", () => {
  const source = readFileSync(
    new URL("../../editor-workspace/ui/pane-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /<PaneFocusedContext\.Provider value=\{focused && shown\}>/);
});
