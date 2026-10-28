/**
 * One mode control for a document, on every screen that shows one: Text · Ink,
 * then Preview. Read is gone; its job is Preview, beside the editor. There is
 * no PDF mode: a PDF is read and inked in one place, so it is Ink.
 * A mode a document cannot take is greyed, not hidden, so the toolbar keeps its
 * shape from one document to the next.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { DocumentModeSwitch, canSplit, modeOptions } from "../document-mode-switch";
import {
  MD_SPLIT_KEY,
  readMdSplitSide,
  setMdPreviewMode,
  subscribeMdPreviewMode,
  mdPreviewSnapshot,
  setMdSplitSide,
} from "@/lib/hooks/use-md-preview-mode";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

function withStorage<T>(run: (store: Map<string, string>) => T): T {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  };
  try {
    return run(store);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
}

test("every text document offers Text and Ink; one without ink greys Ink rather than hiding it", () => {
  const shape = (modes: Parameters<typeof modeOptions>[0]) =>
    modeOptions(modes).map((o) => `${o.ariaLabel}${o.disabled ? " (off)" : ""}`);
  assert.deepEqual(shape(["edit", "ink"]), ["Text", "Ink"]);
  assert.deepEqual(shape(["edit"]), ["Text", "Ink (off)"]);
  // A PDF is Ink only: the same two segments, Text greyed, so nothing jumps.
  assert.deepEqual(shape(["ink"]), ["Text (off)", "Ink"]);
  for (const o of modeOptions(["edit", "ink"])) assert.ok(o.title.length > 0, `${o.value} has a hint`);
});

test("Text and Ink are icons, not words: each named for screen readers and the hover tip", () => {
  const html = renderToStaticMarkup(<DocumentModeSwitch modes={["edit", "ink"]} mode="edit" onMode={() => {}} split={false} />);
  for (const name of ["Text", "Ink"]) {
    const tag = html.match(new RegExp(`<button[^>]*aria-label="${name}"[^>]*>(.*?)</button>`));
    assert.ok(tag, `${name} is named`);
    assert.match(tag[1] ?? "", /^<svg/, `${name} shows an icon`);
  }
  assert.doesNotMatch(html, />(Text|Ink)</);
});

test("Text and Ink are plain icon buttons like the toolbar's, not boxed segments", () => {
  const html = renderToStaticMarkup(<DocumentModeSwitch modes={["edit", "ink"]} mode="edit" onMode={() => {}} split={false} />);
  assert.match(html, /role="group" aria-label="Mode"/);
  assert.doesNotMatch(html, /wf-seg/);
  for (const name of ["Text", "Ink"]) assert.match(html, new RegExp(`<button[^>]*class="wf-btn wf-icon wf-sm"[^>]*aria-label="${name}"|<button[^>]*aria-label="${name}"[^>]*class="wf-btn wf-icon wf-sm"`));
  // The current mode, and an open Preview, show as an accent-coloured icon.
  const css = read("app/styles/buttons.css");
  assert.match(css, /:root:root \.wf-btn\.wf-icon\[aria-pressed="true"\] \{ color: var\(--accent\); \}/);
});

test("there is no Read mode any more", () => {
  for (const modes of [["edit", "ink"], ["edit"], ["ink"]] as const) {
    assert.ok(!modeOptions(modes).some((o) => /read/i.test(o.ariaLabel)));
  }
});

test("Split is only for Text: a sheet or a PDF has no Markdown to preview", () => {
  assert.equal(canSplit("edit"), true);
  assert.equal(canSplit("ink"), false);
});

test("the split side is remembered apart from whether the preview is on", () =>
  withStorage((store) => {
    assert.equal(readMdSplitSide(), "side", "beside is the default");
    setMdPreviewMode("below");
    setMdPreviewMode("off");
    assert.equal(readMdSplitSide(), "below", "turning Split off forgot its side");
    setMdSplitSide("side");
    assert.equal(store.get(MD_SPLIT_KEY), "side");
    assert.equal(mdPreviewSnapshot(), "off", "choosing a side while off turned Split on");
  }));

test("every editor and the header switch share one preview choice", () =>
  withStorage(() => {
    let heard = 0;
    const stop = subscribeMdPreviewMode(() => heard++);
    setMdPreviewMode("side");
    assert.equal(mdPreviewSnapshot(), "side");
    setMdSplitSide("below");
    assert.equal(mdPreviewSnapshot(), "below", "a new side applies to an open split");
    stop();
    setMdPreviewMode("off");
    assert.equal(heard, 2);
  }));

test("on a page the control is Mode then a Preview toggle, greyed outside Text", () => {
  const on = renderToStaticMarkup(<DocumentModeSwitch modes={["edit", "ink"]} mode="edit" onMode={() => {}} />);
  assert.match(on, /aria-label="Mode"/);
  assert.match(on, /aria-pressed="false"[^>]*>Preview</);
  assert.doesNotMatch(on, />Read</);
  const ink = renderToStaticMarkup(<DocumentModeSwitch modes={["edit", "ink"]} mode="ink" onMode={() => {}} />);
  assert.match(ink, /disabled=""[^>]*>Preview</, "Preview greys out on the sheet");
  const noInk = renderToStaticMarkup(<DocumentModeSwitch modes={["edit"]} mode="edit" onMode={() => {}} />);
  assert.match(noInk, /<button[^>]*aria-label="Ink"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Ink"/, "Ink is greyed, not gone");
  const preview = read("features/editor-workspace/ui/md-live-preview.tsx");
  assert.doesNotMatch(preview, /<SegmentedControl|"Live preview"|PreviewToggle/);
  assert.doesNotMatch(read("app/styles/editor-workspace.css"), /\.md-live-choice\b/);
});

test("on a page, where Split is inline, its side lives in the ⋯ menu", () => {
  const src = read("components/document-mode-switch.tsx");
  assert.match(src, /<CardMenu\b/);
  assert.match(src, /Preview beside/);
  assert.match(src, /Preview below/);
});

test("the page number has no field box, like the zoom value beside it", () => {
  // The bold themes' input border beat .ink-page-input { border: 0 }, so the
  // page switcher showed a boxed field the zoom pill does not have.
  const css = readFileSync(fileURLToPath(new URL("../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
  assert.match(css, /:root:root:root \.ink-page-input \{ border: 0; \}/);
});
