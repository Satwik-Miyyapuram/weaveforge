import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MultiSelect } from "@/components/multi-select";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The dismissal hook installs a `document` listener the moment the menu opens,
 * and react-test-renderer supplies no DOM. A no-op pair is enough: these tests
 * drive the keyboard handlers directly and never simulate a click-away.
 */
(globalThis as { document?: unknown }).document = {
  addEventListener: () => {},
  removeEventListener: () => {},
};

const OPTIONS = [
  { value: "running", label: "Running" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
];

/**
 * A keyboard event good enough for a handler that only reads `key` and may call
 * `preventDefault`/`stopPropagation`. There is no DOM here: react-test-renderer
 * gives no instances, so the component's `focus()` calls are optional-chained
 * no-ops and the assertions are made against the props it renders instead.
 */
function press(key: string): KeyboardEventLike {
  const event: KeyboardEventLike = {
    key,
    prevented: false,
    stopped: false,
    preventDefault: () => { event.prevented = true; },
    stopPropagation: () => { event.stopped = true; },
  };
  return event;
}

interface KeyboardEventLike {
  key: string;
  prevented: boolean;
  stopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/** The rendered className, read off a node whose props are deliberately untyped. */
function classNameOf(node: { props: Record<string, unknown> }): string {
  const value = node.props.className;
  return typeof value === "string" ? value : "";
}

interface Rendered {
  renderer: ReactTestRenderer;
  /** The element carrying the given `data-row`, e.g. row 2. */
  byDataRow: (row: number) => { props: Record<string, unknown> } | undefined;
  trigger: () => { props: Record<string, unknown> };
  listbox: () => { props: Record<string, unknown> } | undefined;
  keyOn: (node: { props: Record<string, unknown> }, key: string) => KeyboardEventLike;
}

async function render(values: string[], onChange: (next: string[]) => void): Promise<Rendered> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      createElement(MultiSelect, {
        id: "filter",
        values,
        options: OPTIONS,
        onChange,
        allLabel: "All statuses",
        ariaLabel: "Filter by status",
      }),
    );
  });
  const find = (predicate: (props: Record<string, unknown>) => boolean) =>
    renderer.root.findAll((node) => typeof node.type === "string" && predicate(node.props as Record<string, unknown>));
  const byDataRow = (row: number) => find((p) => p["data-row"] === row)[0];
  const trigger = () => find((p) => p["aria-haspopup"] === "listbox")[0]!;
  const listbox = () => find((p) => p.role === "listbox")[0];
  const keyOn = (node: { props: Record<string, unknown> }, key: string) => {
    const event = press(key);
    act(() => {
      (node.props.onKeyDown as (e: unknown) => void)(event);
    });
    return event;
  };
  return { renderer, byDataRow, trigger, listbox, keyOn };
}

test("MultiSelect: ArrowDown opens the menu on the first selected row", async () => {
  const seen: string[][] = [];
  const view = await render(["failed"], (next) => seen.push(next));

  assert.equal(view.trigger()!.props["aria-expanded"], false);
  assert.equal(view.listbox(), undefined);

  view.keyOn(view.trigger()!, "ArrowDown");

  assert.equal(view.trigger()!.props["aria-expanded"], true);
  assert.ok(view.listbox(), "the listbox is rendered once open");
  // "failed" is option index 2, so row 3 — row 0 is the "all" row.
  assert.equal(classNameOf(view.byDataRow(3)!).includes(" active"), true);
});

test("MultiSelect: Space toggles the active row and leaves the menu open", async () => {
  const seen: string[][] = [];
  const view = await render([], (next) => seen.push(next));

  view.keyOn(view.trigger()!, " ");           // opens on row 0 ("All")
  const list = view.listbox()!;
  view.keyOn(list, "ArrowDown");              // row 1 — "running"
  const event = view.keyOn(list, " ");        // toggle it

  assert.equal(event.prevented, true, "Space must not scroll the page");
  assert.deepEqual(seen, [["running"]]);
  assert.equal(view.trigger()!.props["aria-expanded"], true, "toggling keeps the menu open");
});

test("MultiSelect: Home and End reach the first and last rows", async () => {
  const seen: string[][] = [];
  const view = await render([], (next) => seen.push(next));
  view.keyOn(view.trigger()!, "ArrowDown");
  const list = view.listbox()!;

  view.keyOn(list, "End");
  assert.equal(classNameOf(view.byDataRow(3)!).includes(" active"), true);
  view.keyOn(list, "Enter");
  assert.deepEqual(seen, [["failed"]]);

  view.keyOn(list, "Home");
  assert.equal(classNameOf(view.byDataRow(0)!).includes(" active"), true);
});

test("MultiSelect: Escape closes, restores focus to the trigger and stops propagating", async () => {
  const view = await render(["done"], () => {});
  view.keyOn(view.trigger()!, "ArrowDown");
  const list = view.listbox()!;

  const event = view.keyOn(list, "Escape");

  assert.equal(view.trigger()!.props["aria-expanded"], false);
  assert.equal(view.listbox(), undefined);
  // Stopped so the document-level Escape in useDismissOnOutside does not also
  // run: that path closes without returning focus to the trigger.
  assert.equal(event.stopped, true);
});

test("MultiSelect: the trigger advertises the listbox it controls, and no unsupported activedescendant", async () => {
  const view = await render([], () => {});
  view.keyOn(view.trigger()!, "ArrowDown");

  assert.equal(view.trigger()!.props["aria-controls"], "filter-listbox");
  assert.equal(view.listbox()!.props.id, "filter-listbox");
  assert.equal(view.listbox()!.props["aria-multiselectable"], "true");
  // Focus moves onto the options, so the attribute that would be needed only if
  // focus stayed on the trigger must not be there.
  assert.equal(view.trigger()!.props["aria-activedescendant"], undefined);
});
