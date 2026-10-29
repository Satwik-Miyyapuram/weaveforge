/**
 * A document's own extras ride the one bar: a report's experiment artifact in
 * Insert, its citation format in More. The bar keeps its shape; only which
 * controls are live changes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { InkBar, InkIdleBar } from "@/features/ink";
import { hasInsertItems } from "../ui/ink-bar-view";
import { MenuSections } from "../ui/ink-bar-more";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

type Control = { label: string; disabled: boolean };

function controls(element: ReturnType<typeof createElement>): Control[] {
  return withWindow(() => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(element);
    });
    const out = tree.root
      .findAll((n) => (n.type === "button" || n.type === "input") && typeof n.props["aria-label"] === "string")
      .map((n) => ({ label: String(n.props["aria-label"]), disabled: Boolean(n.props.disabled) }))
      .filter((c) => !/palette|Fold the tools/i.test(c.label));
    act(() => tree.unmount());
    return out;
  });
}

const live = (cs: Control[]) => cs.filter((c) => !c.disabled).map((c) => c.label);

const greyed = {
  readOnly: true, tool: "pen", colour: "accent", width: 4,
  onTool: noop, onColour: noop, onWidth: noop, onUndo: noop, onRedo: noop, onSelect: noop, selectPointer: true,
} as unknown as Parameters<typeof InkBar>[0];

test("an Insert item of the document's own makes Insert live", () => {
  assert.equal(hasInsertItems({}), false);
  assert.equal(hasInsertItems({ items: [{ label: "Experiment artifact…", onSelect: noop }] }), true);
  const bar = controls(createElement(InkBar, { ...greyed, insertItems: [{ label: "Experiment artifact…", onSelect: noop }] }));
  assert.deepEqual(live(bar), ["Insert"]);
});

test("a More section of the document's own makes More live", () => {
  const sections = [{ label: "Cite as", items: [{ label: "Author–year", checked: true, onSelect: noop }] }];
  const bar = controls(createElement(InkBar, { ...greyed, moreSections: sections }));
  assert.deepEqual(live(bar), ["More ink options"]);
});

test("More sections draw a heading and their items; a checked item is a radio", () => {
  const picked: string[] = [];
  const choose = (run: () => void) => () => {
    picked.push("closed");
    run();
  };
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      createElement(MenuSections, {
        choose,
        sections: [
          { label: "Cite as", items: [{ label: "Numeric", checked: false, onSelect: () => picked.push("numeric") }] },
          { label: "Paper", items: [{ label: "Refresh paper details", onSelect: () => picked.push("refresh") }] },
        ],
      }),
    );
  });
  const groups = tree.root.findAll((n) => n.type === "div" && n.props.role === "group");
  assert.deepEqual(groups.map((g) => g.props["aria-label"]), ["Cite as", "Paper"]);
  const items = tree.root.findAll((n) => n.type === "button");
  assert.equal(items[0]!.props.role, "menuitemradio");
  assert.equal(items[1]!.props.role, "menuitem");
  act(() => items[0]!.props.onClick());
  act(() => items[1]!.props.onClick());
  // A choice of format keeps the menu open, like Paper; an action closes it first.
  assert.deepEqual(picked, ["numeric", "closed", "refresh"]);
});

test("the idle bar is the one bar greyed: Insert works only when handed a picture", () => {
  assert.deepEqual(live(controls(createElement(InkIdleBar, {}))), []);
  assert.deepEqual(live(controls(createElement(InkIdleBar, { onInsertImage: noop }))), ["Insert"]);
  const both = controls(
    createElement(InkIdleBar, { onInsertImage: noop, moreSections: [{ label: "Cite as", items: [{ label: "x", onSelect: noop }] }] }),
  );
  assert.deepEqual(live(both), ["Insert", "More ink options"]);
});

test("the ink note's read view draws the one bar, not a bar of its own", () => {
  const reader = src("../ui/ink-reader.tsx");
  assert.match(reader, /<ToolbarSlot>\s*<InkBar\b/);
  assert.match(reader, /\breadOnly\b/);
  assert.doesNotMatch(reader, /ink-reader-bar|Reset zoom/);
});
