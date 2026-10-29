/**
 * The ink bar reads the same on a note and on a paper (design D18, DA-119):
 * one name for Select, swatches one size, the pen's swatch marked as the nib
 * too, the zoom level named for what it does, one check mark in More, a menu
 * that stays inside the window, and a tool switch that leaves the page where
 * it was.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, createRef, type ReactPortal } from "react";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";

import { InkBar } from "@/features/ink";
import { BarMenuList } from "../ui/ink-bar-menus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BarProps = Parameters<typeof InkBar>[0];
const noop = () => {};
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

function withWindow<T>(run: () => T): T {
  const events = new EventTarget();
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = {
    localStorage: { getItem: () => null, setItem: noop },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  try {
    return run();
  } finally {
    g.window = before;
  }
}

function render(extra: Partial<BarProps>): ReactTestRenderer {
  const props = {
    tool: "pen", colour: "accent", width: 4,
    onTool: noop, onColour: noop, onWidth: noop, onUndo: noop, onRedo: noop,
    onSelect: noop, selectActive: false,
    ...extra,
  } as BarProps;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(InkBar, props));
  });
  return tree;
}

const labelled = (tree: ReactTestRenderer, label: string): ReactTestInstance[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props["aria-label"] === label);

test("Select has one name on every surface", () => {
  withWindow(() => {
    const tree = render({});
    assert.equal(labelled(tree, "Select (V)").length, 1);
    act(() => tree.unmount());
  });
  assert.doesNotMatch(src("../ui/ink-host.tsx"), /selectLabel=/);
  assert.doesNotMatch(src("../ui/ink-bar.tsx"), /Select text/);
});

test("the note's zoom level opens the same view menu as the reader's", () => {
  withWindow(() => {
    const tree = render({ zoom: 1, onZoom: noop });
    const level = tree.root.find((n) => n.type === "button" && n.props["aria-haspopup"] === "menu" && n.props["aria-label"] === "Zoom, fit and rotate");
    assert.equal(level.props.title, "Zoom 100%, fit and rotate");
    act(() => tree.unmount());
  });
});

test("the pen's swatch shows its nib whatever the tool, so it reads as colour and size", () => {
  withWindow(() => {
    for (const extra of [{ tool: "eraser" }, { selectActive: true }] as Partial<BarProps>[]) {
      const tree = render(extra);
      assert.equal(tree.root.findAll((n) => n.props.className === "ink-pen-trigger-nib").length, 1);
      act(() => tree.unmount());
    }
  });
});

test("More draws one check mark: the menu item's own", () => {
  assert.doesNotMatch(src("../ui/ink-bar-more.tsx"), /✓|ink-menu-check/);
});

test("a selected swatch is ringed, not grown, so every swatch is one size", () => {
  const ws = src("../../../app/styles/editor-workspace.css");
  const pressed = ws.slice(ws.indexOf('.ink-swatch[aria-pressed="true"]'));
  assert.doesNotMatch(pressed.slice(0, pressed.indexOf("}")), /scale/);
  const overlays = src("../../../app/styles/overlays.css");
  assert.doesNotMatch(overlays, /\.colour-menu-current \{ transform: scale/);
});

test("a bar menu taller than the window scrolls inside it", () => {
  const g = globalThis as { document?: unknown };
  const before = g.document;
  g.document = { body: { nodeType: 1 } };
  try {
    const portal = BarMenuList({ label: "More", listRef: createRef(), pos: { top: 8, left: 8 }, children: null }) as ReactPortal;
    const style = (portal.children as { props: { style: Record<string, string> } }).props.style;
    assert.equal(style.maxHeight, "calc(100vh - 16px)");
    assert.equal(style.overflowY, "auto");
  } finally {
    g.document = before;
  }
});

test("picking a pen tool leaves the side panel, so the page does not jump", () => {
  const reader = src("../../reader/ui/pdf-reader/pdf-reader.tsx");
  assert.doesNotMatch(reader, /!penOpen && !?sideCollapsed/);
  assert.doesNotMatch(reader, /!penOpen && \(outline\.length/);
});
