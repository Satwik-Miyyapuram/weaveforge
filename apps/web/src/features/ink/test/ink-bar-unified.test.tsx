/**
 * One Editor toolbar: a note in Text, a note in Ink and a PDF draw the same
 * controls in the same order. Only which ones are greyed differs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { InkBar } from "@/features/ink";
import { ReaderSearchBar } from "@/features/reader/ui/reader-search-bar";

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

const base = {
  tool: "pen", colour: "accent", width: 4,
  onTool: noop, onColour: noop, onWidth: noop, onUndo: noop, onRedo: noop,
} as const;

/** What the ink note hands the bar (`ink-host.tsx`). */
const noteInk = {
  ...base,
  page: 2, pages: 3, onPrevPage: noop, onNextPage: noop, onGoToPage: noop, onAddPage: noop,
  onSelect: noop, selectPointer: true, selected: 2,
  onCopyStrokes: noop, onCopyAsText: noop, onDeleteSelection: noop,
  zoom: 1, onZoom: noop,
  onRecognise: noop,
  onAddImage: noop, onInsertPage: noop, takesPictureDrops: true,
  paper: "plain", onPaper: noop, onPrint: noop, onExportPng: noop, onExportSvg: noop,
} as unknown as BarProps;

/** What the PDF reader hands it; the paper may be marked unless `readOnly`. */
function pdf(readOnly: boolean): BarProps {
  return {
    ...base,
    readOnly,
    page: 3, pages: 12, onPrevPage: noop, onNextPage: noop, onGoToPage: noop,
    view: { zoomPercent: 125, onZoomIn: noop, onZoomOut: noop, onZoomTo: noop, fit: "width", onFitPage: noop, onFitWidth: noop, onRotate: noop },
    find: createElement(ReaderSearchBar, { pages: [], isOpen: false, onOpenChange: noop, onJump: noop, onMatches: noop }),
    onSelect: noop, selected: 1, onDeleteSelection: noop,
    onClip: readOnly ? undefined : noop,
    onTextBox: readOnly ? undefined : noop,
    onAddPicture: readOnly ? undefined : noop,
    onPrintPaper: noop,
  } as unknown as BarProps;
}

/** The greyed bar a note shows in Text: only Insert works (an image). */
const noteText = { ...base, readOnly: true, onSelect: noop, selectPointer: true, onAddPicture: noop } as unknown as BarProps;

type Control = { label: string; disabled: boolean };

function controls(props: BarProps): Control[] {
  return withWindow(() => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(createElement(InkBar, props));
    });
    const out = tree.root
      .findAll((n) => (n.type === "button" || n.type === "input") && typeof n.props["aria-label"] === "string")
      .map((n) => ({ label: String(n.props["aria-label"]), disabled: Boolean(n.props.disabled) }))
      // Fold and move show in focus mode only (CSS); they are the same everywhere.
      .filter((c) => !/palette|Fold the tools/i.test(c.label));
    act(() => tree.unmount());
    return out;
  });
}

const labels = (cs: Control[]) => cs.map((c) => c.label);
const enabled = (cs: Control[]) => cs.filter((c) => !c.disabled).map((c) => c.label);

const ORDER = [
  "Select (V)", "Pen (P)", "Highlighter (H)", "Eraser (E)", "Lasso (L)",
  "Pen colour and nib", "Undo", "Redo",
  "Previous page", "Page number", "Next page", "Add a blank page",
  "Zoom out", "Zoom, fit and rotate", "Zoom in",
  "Find in document", "Insert", "Recognise", "More ink options",
];

test("note Text, note Ink and a PDF draw one identical, ordered set of controls", () => {
  const ink = labels(controls(noteInk));
  assert.deepEqual(labels(controls(noteText)), ink);
  assert.deepEqual(labels(controls(pdf(false))), ink);
  assert.deepEqual(labels(controls(pdf(true))), ink);
  // The fixed controls, in order (quick colours sit between the tools and the pen's swatch).
  assert.deepEqual(ink.filter((l) => ORDER.includes(l)), ORDER);
  assert.equal(ink.filter((l) => l.startsWith("Ink colour:")).length, 5);
  const firstColour = ink.findIndex((l) => l.startsWith("Ink colour:"));
  assert.ok(firstColour > ink.indexOf("Lasso (L)") && firstColour < ink.indexOf("Pen colour and nib"));
});

test("lasso actions are not on the bar; they sit at the selection", () => {
  for (const props of [noteInk, pdf(false)]) {
    const all = labels(controls(props)).join("|");
    assert.doesNotMatch(all, /Copy|Delete/);
  }
});

test("in Text only Insert works", () => {
  assert.deepEqual(enabled(controls(noteText)), ["Insert"]);
});

test("a PDF the reader cannot mark greys the tools, colours, undo and Insert, keeps pages, view and find", () => {
  const live = enabled(controls(pdf(true)));
  for (const label of ["Select (V)", "Pen (P)", "Pen colour and nib", "Undo", "Insert", "Add a blank page", "Recognise"]) {
    assert.ok(!live.includes(label), label);
  }
  assert.equal(live.filter((l) => l.startsWith("Ink colour:")).length, 0);
  for (const label of ["Page number", "Zoom, fit and rotate", "Find in document", "More ink options"]) {
    assert.ok(live.includes(label), label);
  }
});

test("a markable PDF greys only what it has no use for", () => {
  const off = controls(pdf(false)).filter((c) => c.disabled).map((c) => c.label);
  assert.deepEqual(off, ["Add a blank page", "Recognise"]);
});

test("the ink note greys nothing it can do", () => {
  const off = controls(noteInk).filter((c) => c.disabled).map((c) => c.label);
  assert.deepEqual(off, ["Find in document"]);
});

test("Select draws the arrow everywhere", () => {
  const bar = src("../ui/ink-bar.tsx");
  assert.doesNotMatch(bar, /selectPointer \? <PointerGlyph \/> : <SelectGlyph \/>/);
});

test("the reader puts its pages, view, find and more into the one bar, not beside it", () => {
  const reader = src("../../reader/ui/pdf-reader/pdf-reader.tsx");
  const tools = reader.slice(reader.indexOf('className="pdf-reader-tools"'), reader.indexOf("<InkBar"));
  for (const own of ["<PagePill", "<ViewMenu", "<ReaderSearchBar", "<MoreMenu"]) {
    assert.ok(!tools.includes(own), own);
  }
});
