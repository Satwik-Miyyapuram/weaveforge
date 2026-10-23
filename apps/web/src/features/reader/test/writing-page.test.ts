/**
 * The writing page beside each PDF page is a setting, not a side effect of the pen.
 *
 * It used to follow the pen, so opening or closing the pen flipped the reader
 * between one page and two and the paper jumped under the cursor. What is
 * pinned here: the switch is stored and on by default, the reader's layout
 * reads it rather than the pen, and the text layer's selection is the tint the
 * reader picks rather than the browser's, whose HighlightText glyphs showed as
 * white ghosts over the rendered page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { readWritingPage, writeWritingPage } from "../ui/pdf-reader/writing-page";

function withStorage<T>(store: Map<string, string> | null, run: () => T): T {
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = {
    get localStorage() {
      if (!store) throw new Error("storage blocked");
      return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      };
    },
  };
  try {
    return run();
  } finally {
    g.window = before;
  }
}

test("the writing page is on until it is turned off, and stays as set", () => {
  const store = new Map<string, string>();
  withStorage(store, () => {
    assert.equal(readWritingPage(), true);
    writeWritingPage(false);
    assert.equal(readWritingPage(), false);
    writeWritingPage(true);
    assert.equal(readWritingPage(), true);
  });
});

test("blocked storage reads as the default and does not throw on write", () => {
  withStorage(null, () => {
    assert.equal(readWritingPage(), true);
    assert.doesNotThrow(() => writeWritingPage(false));
  });
});

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "ui", "pdf-reader");
const webSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("the page layout follows the setting, not the pen", () => {
  const source = readFileSync(path.join(uiDir, "pdf-reader.tsx"), "utf8");
  assert.match(source, /pageShare:\s*writingPage\s*\?/);
  assert.doesNotMatch(source, /pageShare:\s*penOpen/);
  assert.match(source, /\{writingPage && pageSize && \(\s*<PageMargin/);
});

test("the text layer's selection is the reader's tint with no glyphs", () => {
  const css = readFileSync(path.join(webSrc, "app", "styles", "reader.css"), "utf8");
  const rule = css.match(/\.pdf-reader-textlayer ::selection\s*\{([^}]*)\}/);
  assert.ok(rule, "a ::selection rule on the text layer");
  assert.match(rule[1]!, /color:\s*transparent/);
  assert.match(rule[1]!, /background:\s*var\(--reader-select-color/);
  // Theme rules such as brutal.css's `:root:is(...) ::selection` are more
  // specific; without !important their opaque colour paints the transparent
  // text layer as ghost glyphs offset from the canvas text.
  for (const prop of ["color", "-webkit-text-fill-color", "background"]) {
    assert.match(rule[1]!, new RegExp(`(^|[\\s;])${prop}:[^;]*!important`), `${prop} must be !important`);
  }
  const reader = readFileSync(path.join(uiDir, "pdf-reader.tsx"), "utf8");
  assert.match(reader, /"--reader-select-color" as string\]:/);
});
