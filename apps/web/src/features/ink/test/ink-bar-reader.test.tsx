/**
 * The reader draws its chrome with the ink note's own bar: one toolbar, one
 * dock, one set of quick colours. These pin what the reader hands it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";

import { PaletteDockButton } from "@/components/palette-dock";
import { INK_RENDER_COLOURS, InkBar, paletteHex, paletteName } from "@/features/ink";
import { InsertMenu, PageField, ViewMenu } from "../ui/ink-bar-view";
import { NibRow } from "../ui/ink-bar";
import { WritingPageItem, ZoomPresets } from "../ui/ink-bar-view";

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
    assert.equal(byLabel(tree, "Select (V)")[0]!.props["aria-pressed"], true);
    assert.equal(byLabel(tree, "Pen (P)")[0]!.props["aria-pressed"], false);
    act(() => byLabel(tree, "Select (V)")[0]!.props.onClick());
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
    assert.equal(byLabel(tree, "Zoom 90%, fit and rotate").length, 1);
    // One pair of steppers, inside the zoom control.
    assert.equal(byLabel(tree, "Zoom in").length, 1);
    assert.equal(byLabel(tree, "Zoom out").length, 1);
    act(() => tree.unmount());
  });
});

test("the writing-page switch is a checked menu item that reports a click", () => {
  let clicks = 0;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(createElement(WritingPageItem, { on: true, onChange: () => (clicks += 1) }));
  });
  const item = tree.root.find((n) => n.type === "button" && n.props.role === "menuitemcheckbox");
  assert.equal(item.props["aria-checked"], true);
  act(() => item.props.onClick());
  assert.equal(clicks, 1);
  act(() => tree.unmount());
});

test("the zoom percent is its own trigger, not a square tool", () => {
  withWindow(new Map(), () => {
    const tree = render(readerBar({ view: { zoomPercent: 100, onZoomIn: noop, onZoomOut: noop, onZoomTo: noop } }));
    const trigger = byLabel(tree, "Zoom 100%, fit and rotate")[0]!;
    // `.ink-tool` is a 32px square everywhere, which clipped the percent.
    assert.equal(String(trigger.props.className).split(" ").includes("ink-tool"), false);
    act(() => tree.unmount());
  });
});

test("the zoom presets check the current level and zoom to the one picked", () => {
  const zoomed: number[] = [];
  let closed = 0;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      createElement(ZoomPresets, { zoomPercent: 100, onZoomTo: (p: number) => zoomed.push(p), onChosen: () => (closed += 1) }),
    );
  });
  const item = (text: string) =>
    tree.root.find((n) => n.props.role === "menuitemradio" && n.findByType("span").children.includes(text));
  assert.equal(item("100%").props["aria-checked"], true);
  assert.equal(item("150%").props["aria-checked"], false);
  act(() => item("150%").props.onClick());
  assert.deepEqual(zoomed, [150]);
  assert.equal(closed, 1);
  act(() => tree.unmount());
});

test("the highlighter offers its own sizes, and picks one", () => {
  const picked: number[] = [];
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      createElement(NibRow, {
        tool: "highlighter",
        width: 3,
        highlighterWidth: 60,
        onWidth: noop,
        onHighlighterWidth: (w: number) => picked.push(w),
      }),
    );
  });
  assert.equal(byLabel(tree, "Pen nib width").length, 0);
  assert.equal(byLabel(tree, "Highlighter 6 mm")[0]!.props["aria-pressed"], true);
  act(() => byLabel(tree, "Highlighter 9 mm")[0]!.props.onClick());
  assert.deepEqual(picked, [90]);
  // The pen keeps its nibs, and a bar that cannot size the highlighter shows those too.
  act(() => tree.update(createElement(NibRow, { tool: "highlighter", width: 3, highlighterWidth: 60, onWidth: noop })));
  assert.equal(byLabel(tree, "Highlighter width").length, 0);
  assert.equal(byLabel(tree, "Pen nib width").length, 1);
  act(() => tree.unmount());
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
    assert.equal(byLabel(tree, "Select (V)").length, 0);
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

const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

test("the Insert menu offers paste and drop only where the page takes them (DA-115)", () => {
  withWindow(new Map(), () => {
    const reader = render(readerBar());
    assert.equal(reader.root.findByType(InsertMenu).props.takesPictureDrops, undefined);
    act(() => reader.unmount());
    const notes = render(readerBar({ onAddPicture: undefined, takesPictureDrops: true }));
    assert.equal(notes.root.findByType(InsertMenu).props.takesPictureDrops, true);
    act(() => notes.unmount());
  });
  // The menu list is portalled, which this renderer cannot open; pin the gate.
  const view = src("../ui/ink-bar-view.tsx");
  assert.match(view, /\{takesPictureDrops \? \(\s*<p className="ink-menu-hint">Or paste an image, or drop one on the page\.<\/p>/);
  assert.equal(view.match(/ink-menu-hint/g)?.length, 1);
});

test("the notes page says it takes pasted and dropped pictures; the reader does not (DA-115)", () => {
  assert.match(src("../ui/ink-host.tsx"), /takesPictureDrops\b/);
  assert.doesNotMatch(src("../../reader/ui/pdf-reader/pdf-reader.tsx"), /takesPictureDrops/);
});

test("the reader's zoom is the note's zoom pill, steps and all", () => {
  withWindow(new Map(), () => {
    const shape = (tree: ReactTestRenderer) => {
      const out = byLabel(tree, "Zoom out")[0]!;
      let pill = out.parent!;
      while (pill.type !== "div") pill = pill.parent!;
      return {
        pill: pill.props.className,
        out: out.props.className,
        into: byLabel(tree, "Zoom in")[0]!.props.className,
        steps: pill.children.length,
      };
    };
    const reader = render(readerBar({ view: { zoomPercent: 100, onZoomIn: noop, onZoomOut: noop, onZoomTo: noop } }));
    const note = render(readerBar({ view: undefined, zoom: 1, onZoom: noop }));
    assert.deepEqual(shape(reader), shape(note));
    assert.equal(shape(note).pill, "ink-page-pill ink-zoom-pill");
    act(() => reader.unmount());
    act(() => note.unmount());
  });
});
