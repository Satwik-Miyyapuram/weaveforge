import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { Paper } from "@weaveforge/core";
import type { ResolvedReference } from "../application/reference-lookup";
import { ReferencePopover, type ReferencePopoverProps } from "../ui/reference-popover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = {
  index: 12,
  label: "[12]",
  raw: "Vaswani et al. Attention is all you need. NeurIPS, 2017.",
  page: 9,
  x: 40,
  y: 600,
  authors: ["Vaswani"],
  year: 2017,
  title: "Attention is all you need",
};

const resolved: ResolvedReference = {
  status: "resolved",
  sourceId: "semantic-scholar",
  metadata: { title: "Attention is all you need", authors: ["Vaswani"], year: 2017, venue: "NeurIPS" },
};

function noop(): void {}

function renderPopover(overrides: Partial<ReferencePopoverProps> = {}): string {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(
      createElement(ReferencePopover, {
        entry,
        resolution: resolved,
        onClose: noop,
        onReadLater: noop,
        onAddToList: noop,
        onOpenInReader: noop,
        onLinkPapers: noop,
        onCite: noop,
        onAddManually: noop,
        onJumpToEntry: noop,
        ...overrides,
      }),
    );
  });
  // Read the tree after `act` has flushed — inside the callback the render has
  // not committed and `toJSON()` is null.
  const text = JSON.stringify(renderer!.toJSON());
  act(() => renderer!.unmount());
  return text;
}

test("State A: resolved but not in library offers Read later, list, and cite", () => {
  const text = renderPopover();
  assert.match(text, /Attention is all you need/);
  assert.match(text, /Read later/);
  assert.match(text, /Add to list/);
  assert.match(text, /Cite/);
  // Library-only affordances must not appear before the paper is in the library.
  assert.doesNotMatch(text, /In library/);
  assert.doesNotMatch(text, /Open in reader/);
});

test("State B: in-library papers expose open and link actions instead of add actions", () => {
  const paper = { id: "p1", status: "reading" } as Paper;
  const text = renderPopover({ resolution: { ...resolved, inLibrary: paper } });
  assert.match(text, /In library/);
  assert.match(text, /Open in reader/);
  assert.match(text, /Link papers/);
  assert.doesNotMatch(text, /Read later/);
  assert.doesNotMatch(text, /Add to list/);
});

test("State B: an existing cites relation hides Link papers", () => {
  const paper = { id: "p1", status: "reading" } as Paper;
  const text = renderPopover({ resolution: { ...resolved, inLibrary: paper }, alreadyLinked: true });
  assert.doesNotMatch(text, /Link papers/);
  assert.match(text, /Cite/);
});

test("State C: unresolved entries offer Scholar and manual add, never an empty popover", () => {
  const text = renderPopover({ resolution: { status: "unresolved" } });
  assert.match(text, /No match found/);
  assert.match(text, /scholar\.google\.com\/scholar\?q=/);
  assert.match(text, /Add manually/);
  assert.match(text, /Jump to entry/);
});

test("Pending: a skeleton with a disabled action, never an empty popover", () => {
  const text = renderPopover({ resolution: { status: "pending" } });
  assert.match(text, /pdf-reader-ref-skeleton/);
  assert.match(text, /"disabled":true/);
});
