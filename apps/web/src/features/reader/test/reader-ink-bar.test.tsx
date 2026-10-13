/**
 * The reader draws its chrome with the ink note's own bar: one toolbar, one
 * dock, one set of quick colours. These pin what the reader hands it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";

import { PaletteDockButton } from "@/components/palette-dock";
import { INK_RENDER_COLOURS, InkBar, paletteHex, paletteName } from "@/features/ink";
import { InsertMenu, PageField, ViewMenu } from "@/features/ink/ui/ink-bar-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type BarProps = Parameters<typeof InkBar>[0];

function withWindow<T>(store: Map<string, string>, run: () => T): T {
  const events = new EventTarget();
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
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

const noop = () => {};

function readerBar(extra: Partial<BarProps> = {}): BarProps {
  return {
    tool: "pen",
    colour: "yellow",
    width: 4,
    onTool: noop,
    onColour: noop,
    onWidth: noop,
    onUndo: noop,
    onRedo: noop,
    page: 3,
    pages: 12,
    onPrevPage: noop,
    onNextPage: noop,
    onGoToPage: noop,
    view: { zoomPercent: 125, onZoomIn: noop, onZoomOut: noop, fit: "width", onFitPage: noop, onFitWidth: noop, onRotate: noop },
    selectActive: true,
    onSelect: noop,
    onClip: noop,
    onTextBox: noop,
    onAddPicture: noop,
    quickColours: ["yellow", "green", "blue", "red", "purple"],
    onQuickColour: noop,
    ...extra,
  } as BarProps;
}

function render(props: BarProps): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(InkBar, props));
  });
  return tree;
}

const byLabel = (tree: ReactTestRenderer, label: string): ReactTestInstance[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props["aria-label"] === label);

test("Select is pressed and no ink tool is while the reader selects text", () => {
  withWindow(new Map(), () => {
    let picked = "";
    const tree = render(readerBar({ onSelect: () => (picked = "select") }));
    assert.equal(byLabel(tree, "Select text (V)")[0]!.props["aria-pressed"], true);
    assert.equal(byLabel(tree, "Pen (P)")[0]!.props["aria-pressed"], false);
    act(() => byLabel(tree, "Select text (V)")[0]!.props.onClick());
    assert.equal(picked, "select");
    act(() => tree.unmount());
  });
});

test("an armed insert tool shows on the Insert trigger, not on the pen", () => {
  withWindow(new Map(), () => {
    const tree = render(readerBar({ selectActive: false, insertTool: "clip" }));
    assert.equal(tree.root.findByType(InsertMenu).props.active, "clip");
    assert.equal(byLabel(tree, "Insert")[0]!.props["aria-pressed"], true);
    assert.equal(byLabel(tree, "Pen (P)")[0]!.props["aria-pressed"], false);
    act(() => tree.unmount());
  });
});

test("the reader's View menu: no fits while the pen is out", () => {
  withWindow(new Map(), () => {
    const tree = render(
      readerBar({ view: { zoomPercent: 90, onZoomIn: noop, onZoomOut: noop, onRotate: noop } }),
    );
    const view = tree.root.findByType(ViewMenu);
    assert.equal(view.props.onFitPage, undefined);
    assert.equal(view.props.onFitWidth, undefined);
    assert.equal(byLabel(tree, "View, zoom 90%").length, 1);
    // The old zoom pill is not drawn beside the menu.
    assert.equal(byLabel(tree, "Zoom in").length, 0);
    act(() => tree.unmount());
  });
});

test("the page field goes to the typed page, clamped", () => {
  withWindow(new Map(), () => {
    const went: number[] = [];
    const tree = render(readerBar({ onGoToPage: (p) => went.push(p) }));
    const input = tree.root.findByType(PageField).findByType("input");
    act(() => input.props.onChange({ target: { value: "40" } }));
    act(() => input.props.onBlur({ target: { value: "40" } }));
    act(() => input.props.onBlur({ target: { value: "" } }));
    assert.deepEqual(went, [12, 12]);
    assert.equal(tree.root.findByType(PageField).findByType("input").props.value, "3");
    act(() => tree.unmount());
  });
});

test("the reader's own quick colours are drawn, not the pen's saved ones", () => {
  const store = new Map([["weaveforge.ink.quick-colours", JSON.stringify(["text", "text", "text", "text", "text"])]]);
  withWindow(store, () => {
    const tree = render(readerBar());
    const quick = tree.root
      .findAll((n) => n.props["aria-label"] === "Quick colours" && typeof n.type === "string")[0]!
      .findAll((n) => n.type === "button")
      .map((n) => n.props["aria-label"]);
    assert.deepEqual(quick, [
      "Ink colour: yellow",
      "Ink colour: green",
      "Ink colour: blue",
      "Ink colour: red",
      "Ink colour: purple",
    ]);
    act(() => tree.unmount());
  });
});

test("a paper the reader cannot mark keeps pages and view, drops tools and Insert", () => {
  withWindow(new Map(), () => {
    const tree = render(readerBar({ readOnly: true }));
    assert.equal(byLabel(tree, "Pen (P)").length, 0);
    assert.equal(byLabel(tree, "Select text (V)").length, 0);
    assert.equal(tree.root.findAllByType(InsertMenu).length, 0);
    assert.equal(tree.root.findAllByType(PageField).length, 1);
    assert.equal(tree.root.findAllByType(ViewMenu).length, 1);
    assert.equal(byLabel(tree, "Page controls").length, 1);
    act(() => tree.unmount());
  });
});

test("two bars share one dock key", () => {
  const store = new Map([["weaveforge.ink.palette-dock", "bottom-right"]]);
  withWindow(store, () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(createElement("div", null, createElement(InkBar, readerBar()), createElement(InkBar, readerBar())));
    });
    const docks = () =>
      tree.root
        .findAll((n) => typeof n.type === "string" && n.props.role === "toolbar")
        .map((n) => n.props["data-dock"] as string);
    assert.deepEqual(docks(), ["bottom-right", "bottom-right"]);
    act(() => tree.root.findAllByType(PaletteDockButton)[0]!.props.onDock("top"));
    assert.equal(store.get("weaveforge.ink.palette-dock"), "top");
    assert.deepEqual(docks(), ["top", "top"]);
    act(() => tree.unmount());
  });
});

test("paletteName reverses paletteHex, and knows no stranger", () => {
  const palette = INK_RENDER_COLOURS;
  for (const name of Object.keys(palette) as (keyof typeof palette)[]) {
    const back = paletteName(palette, paletteHex(palette, name));
    assert.ok(back !== null);
    assert.equal(paletteHex(palette, back), paletteHex(palette, name));
  }
  assert.equal(paletteName(palette, paletteHex(palette, "red").toUpperCase()), paletteName(palette, paletteHex(palette, "red")));
  assert.equal(paletteName(palette, "#010203"), null);
});
