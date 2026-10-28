/**
 * One View control for a document (design D19, DA-103): Edit · Split · Read
 * (· Ink), where Split is Edit with the live preview beside or below it. The
 * editor used to carry a second row, "Live preview: Source / Side / Below",
 * under the pane header's Edit / Read / Ink: two controls for one idea. The
 * split direction moves to the control's ⋯ menu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { DocumentModeSwitch, viewChoice, viewOptions, viewValue } from "../document-mode-switch";
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

test("a document that edits and reads offers Edit · Split · Read (· Ink)", () => {
  assert.deepEqual(viewOptions(["edit", "read", "ink"]).map((o) => o.label), ["Edit", "Split", "Read", "Ink"]);
  assert.deepEqual(viewOptions(["edit", "read"]).map((o) => o.label), ["Edit", "Split", "Read"]);
  // Nothing to preview beside a PDF, so no Split.
  assert.deepEqual(viewOptions(["pdf"]).map((o) => o.label), ["PDF"]);
  for (const o of viewOptions(["edit", "read", "ink"])) assert.ok(o.title.length > 0, `${o.value} has a hint`);
});

test("Split is Edit with the preview on; Edit is the editor alone", () => {
  assert.equal(viewValue(["edit", "read"], "edit", "off"), "edit");
  assert.equal(viewValue(["edit", "read"], "edit", "side"), "split");
  assert.equal(viewValue(["edit", "read"], "edit", "below"), "split");
  // The preview is only drawn while editing.
  assert.equal(viewValue(["edit", "read"], "read", "side"), "read");
  assert.deepEqual(viewChoice("split", "below"), { mode: "edit", preview: "below" });
  assert.deepEqual(viewChoice("edit", "side"), { mode: "edit", preview: "off" });
  assert.deepEqual(viewChoice("read", "side"), { mode: "read" });
  assert.deepEqual(viewChoice("ink", "side"), { mode: "ink" });
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

test("the control is named View and is the only one", () => {
  const out = renderToStaticMarkup(<DocumentModeSwitch modes={["edit", "read", "ink"]} mode="read" onMode={() => {}} />);
  assert.match(out, /aria-label="View"/);
  assert.match(out, />Split</);
  const preview = read("features/editor-workspace/ui/md-live-preview.tsx");
  assert.doesNotMatch(preview, /<SegmentedControl|"Live preview"|PreviewToggle/);
  assert.doesNotMatch(read("app/styles/editor-workspace.css"), /\.md-live-choice\b/);
});

test("the split side lives in the View control's ⋯ menu", () => {
  const src = read("components/document-mode-switch.tsx");
  assert.match(src, /<CardMenu\b/);
  assert.match(src, /Preview beside/);
  assert.match(src, /Preview below/);
});
