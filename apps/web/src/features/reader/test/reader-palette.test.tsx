/**
 * The read palette is the ink palette's shell: one dock between them, and its
 * own five quick colours saved like the pen's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { PaletteDockButton } from "@/components/palette-dock";
import { InkBar } from "@/features/ink/ui/ink-bar";
import { ReaderPalette } from "../ui/reader-palette";
import {
  DEFAULT_READER_QUICK_COLOURS,
  parseReaderQuickColours,
} from "../ui/pdf-reader/use-reader-quick-colours";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("quick colours fall back slot by slot", () => {
  assert.deepEqual(parseReaderQuickColours(null), [...DEFAULT_READER_QUICK_COLOURS]);
  assert.deepEqual(parseReaderQuickColours("not json"), [...DEFAULT_READER_QUICK_COLOURS]);
  const saved = JSON.stringify(["#aaaaaa", "#123456", "#f19837"]);
  assert.deepEqual(parseReaderQuickColours(saved), [
    "#aaaaaa",
    DEFAULT_READER_QUICK_COLOURS[1],
    "#f19837",
    DEFAULT_READER_QUICK_COLOURS[3],
    DEFAULT_READER_QUICK_COLOURS[4],
  ]);
});

test("moving the read palette moves the ink palette: one dock key", () => {
  const store = new Map<string, string>([["weaveforge.ink.palette-dock", "bottom-right"]]);
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
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        createElement("div", null,
          createElement(ReaderPalette, {
            tool: "select",
            colour: "#ffd400",
            quickColours: DEFAULT_READER_QUICK_COLOURS,
            onQuickColour: () => {},
            onTool: () => {},
            onColour: () => {},
          }),
          createElement(InkBar, {
            tool: "pen",
            colour: "text",
            width: 4,
            onTool: () => {},
            onColour: () => {},
            onWidth: () => {},
            onUndo: () => {},
            onRedo: () => {},
          }),
        ),
      );
    });
    const docks = () =>
      tree.root
        .findAll((n) => typeof n.type === "string" && typeof n.props.className === "string" && n.props.className.includes("ink-palette") && "data-dock" in n.props)
        .map((n) => n.props["data-dock"] as string);
    assert.deepEqual(docks(), ["bottom-right", "bottom-right"]);

    const [readerGrip] = tree.root.findAllByType(PaletteDockButton);
    act(() => readerGrip!.props.onDock("top"));
    assert.equal(store.get("weaveforge.ink.palette-dock"), "top");
    assert.deepEqual(docks(), ["top", "top"]);
    act(() => tree.unmount());
  } finally {
    g.window = before;
  }
});
