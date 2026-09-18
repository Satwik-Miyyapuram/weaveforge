import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { PageProjection, PageTextItem } from "@weaveforge/core";
import { ReferenceOverlay, type MentionHit } from "../ui/reference-overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Page text is `"see [12]and\n[13]"` — offsets 0-8, 8-11, newline, 12-16. */
const items: PageTextItem[] = [
  { str: "see [12]", transform: [10, 0, 0, 10, 72, 700], width: 40, height: 10 },
  { str: "and", transform: [10, 0, 0, 10, 72, 680], width: 18, height: 10, hasEOL: true },
  { str: "[13]", transform: [10, 0, 0, 10, 90, 680], width: 20, height: 10 },
];

const projection: PageProjection = { pageWidth: 600, pageHeight: 800, scale: 2, rotation: 0 };

function render(mentions: MentionHit[]): { json: string; opened: MentionHit[] } {
  const opened: MentionHit[] = [];
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(
      createElement(ReferenceOverlay, {
        mentions,
        items,
        projection,
        onOpen: (hit) => opened.push(hit),
      }),
    );
  });
  const json = JSON.stringify(renderer!.toJSON());
  act(() => renderer!.unmount());
  return { json, opened };
}

const citation: MentionHit = {
  key: "c:4",
  kind: "citation",
  start: 4,
  end: 8,
  label: "[12]",
  refIndexes: [12],
};

test("a citation mention becomes one positioned control over its own rect", () => {
  const { json } = render([citation]);
  assert.match(json, /pdf-reader-ref-link/);
  assert.match(json, /"data-kind":"citation"/);
  assert.match(json, /"data-ref-indexes":"12"/);
  assert.match(json, /\[12\]/);
  // PDF rect [92,700,112,710] at scale 2 on an 800pt page → left 184, top 180.
  assert.match(json, /"left":184/);
  assert.match(json, /"top":180/);
  assert.match(json, /"width":40/);
  assert.match(json, /"height":20/);
});

test("figure mentions are marked with their own kind", () => {
  const figure: MentionHit = {
    key: "f:0",
    kind: "figure",
    start: 0,
    end: 3,
    label: "Figure 2",
    refIndexes: [],
    target: { page: 4, y: 300 },
  };
  const { json } = render([figure]);
  assert.match(json, /"data-kind":"figure"/);
  assert.match(json, /Figure 2/);
});

test("a mention with no measurable geometry paints no control", () => {
  // Offsets past the end of the page: no rect, and an unclickable control is
  // worse than none, so nothing is rendered.
  assert.equal(render([{ ...citation, key: "c:99", start: 40, end: 50 }]).json, "null");
});

test("a run with no width is skipped rather than drawn as a dead control", () => {
  const flat: PageTextItem[] = [{ str: "[12]", transform: [10, 0, 0, 10, 72, 700], width: 0, height: 10 }];
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(
      createElement(ReferenceOverlay, {
        mentions: [{ ...citation, start: 0, end: 4 }],
        items: flat,
        projection,
        onOpen: () => {},
      }),
    );
  });
  const json = JSON.stringify(renderer!.toJSON());
  act(() => renderer!.unmount());
  assert.equal(json, "null");
});

test("clicking a mention reports it with the box that was drawn", () => {
  let opened: { hit: MentionHit; anchor: { left: number; top: number } } | undefined;
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(
      createElement(ReferenceOverlay, {
        mentions: [citation],
        items,
        projection,
        onOpen: (hit, anchor) => {
          opened = { hit, anchor };
        },
      }),
    );
  });
  const button = renderer!.root.findByProps({ className: "pdf-reader-ref-link" });
  act(() => button.props.onClick());
  act(() => renderer!.unmount());
  assert.equal(opened?.hit.refIndexes[0], 12);
  assert.deepEqual({ left: opened?.anchor.left, top: opened?.anchor.top }, { left: 184, top: 180 });
});

test("no mentions renders nothing at all", () => {
  assert.equal(render([]).json, "null");
});