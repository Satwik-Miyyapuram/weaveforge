import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { Select } from "@/components/select";

/**
 * A key pressed in a searchable Select's search box is handled once (13-01).
 *
 * The search input and the listbox around it both had the keyboard handler. A
 * React event bubbles from the input to the listbox, and both took the "focus is
 * in the search box" branch — so ArrowDown moved two rows and Enter chose twice,
 * calling `onChange` twice. The tests below bubble each key the way React does:
 * from the element it was pressed on, through every ancestor with a handler.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { document?: unknown }).document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  body: {},
};
Object.assign(globalThis, {
  window: { innerWidth: 1200, innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {} },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
});
// react-test-renderer has no portals; render the portalled menu in place.
createRequire(import.meta.url)("react-dom").createPortal = (node: unknown) => node;

const TRIGGER = { left: 10, right: 210, width: 200, top: 10, bottom: 40 };

interface Pressed {
  key: string;
  target: unknown;
  stopped: boolean;
  prevented: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

async function render(searchable: boolean) {
  const chosen: string[] = [];
  // One mock per host element type, so `searchRef.current` is the very object a
  // key pressed in the search box carries as its target.
  const mocks = new Map<string, object>();
  const mockFor = (type: string) => {
    if (!mocks.has(type)) {
      mocks.set(type, { getBoundingClientRect: () => TRIGGER, focus: () => {}, querySelector: () => null });
    }
    return mocks.get(type)!;
  };
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      createElement(
        Select,
        {
          id: "s",
          value: "a",
          searchable,
          "aria-label": "Pick",
          onChange: (e: { target: { value: string } }) => chosen.push(e.target.value),
        },
        createElement("option", { value: "a" }, "Alpha"),
        createElement("option", { value: "b" }, "Beta"),
        createElement("option", { value: "c" }, "Gamma"),
      ),
      { createNodeMock: (el) => mockFor(String(el.type)) },
    );
  });
  const host = (pred: (p: Record<string, unknown>) => boolean) =>
    renderer.root.find((n) => typeof n.type === "string" && pred(n.props as Record<string, unknown>));
  const trigger = () => host((p) => p.role === "combobox");
  const listbox = () => host((p) => p.role === "listbox");
  const search = () => host((p) => p.type === "search");

  /** Press `key` on `node` and let it bubble through every handler above it. */
  const press = (node: ReactTestInstance, key: string, target: unknown = mockFor(String(node.type))) => {
    const event: Pressed = {
      key,
      target,
      stopped: false,
      prevented: false,
      preventDefault: () => { event.prevented = true; },
      stopPropagation: () => { event.stopped = true; },
    };
    act(() => {
      for (let n: ReactTestInstance | null = node; n && !event.stopped; n = n.parent) {
        if (typeof n.type !== "string") continue;
        const handler = (n.props as { onKeyDown?: (e: Pressed) => void }).onKeyDown;
        handler?.(event);
      }
    });
    return event;
  };
  const activeOption = () => trigger().props["aria-activedescendant"] as string | undefined;
  return { chosen, trigger, listbox, search, press, activeOption };
}

test("Select search box: Enter chooses once", async () => {
  const view = await render(true);
  view.press(view.trigger(), "ArrowDown");
  view.press(view.search(), "ArrowDown");
  view.press(view.search(), "Enter");
  assert.deepEqual(view.chosen, ["b"]);
});

test("Select search box: ArrowDown and ArrowUp move one row", async () => {
  const view = await render(true);
  view.press(view.trigger(), "ArrowDown"); // opens on the selected row, "a"
  assert.equal(view.activeOption(), "s-opt-0");
  view.press(view.search(), "ArrowDown");
  assert.equal(view.activeOption(), "s-opt-1");
  view.press(view.search(), "ArrowDown");
  assert.equal(view.activeOption(), "s-opt-2");
  view.press(view.search(), "ArrowUp");
  assert.equal(view.activeOption(), "s-opt-1");
});

test("Select search box: Escape closes, and the key is not scrolled with", async () => {
  const view = await render(true);
  view.press(view.trigger(), "ArrowDown");
  const event = view.press(view.search(), "Escape");
  assert.equal(event.prevented, true);
  assert.equal(view.trigger().props["aria-expanded"], false);
  assert.deepEqual(view.chosen, []);
});

test("Select search box: typing a letter is left to the input", async () => {
  const view = await render(true);
  view.press(view.trigger(), "ArrowDown");
  const event = view.press(view.search(), "g");
  assert.equal(event.prevented, false);
  assert.equal(view.trigger().props["aria-expanded"], true);
});

test("Select without search: the listbox moves one row and chooses once", async () => {
  const view = await render(false);
  view.press(view.trigger(), "ArrowDown");
  view.press(view.listbox(), "ArrowDown");
  assert.equal(view.activeOption(), "s-opt-1");
  view.press(view.listbox(), "Enter");
  assert.deepEqual(view.chosen, ["b"]);
});
