import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// reader-screen.tsx needs the wasm core to load, so the wrap is checked in its source.
const source = readFileSync(
  resolve(process.cwd(), "src/features/reader/ui/reader-screen.tsx"),
  "utf8",
);

test("the reader wraps PaperPdfPane in a Reader error boundary", () => {
  const open = source.indexOf('<PaneErrorBoundary label="Reader">');
  const pane = source.indexOf("<PaperPdfPane", open);
  const close = source.indexOf("</PaneErrorBoundary>", pane);
  assert.ok(open >= 0, "boundary opens");
  assert.ok(pane > open, "pane sits inside the boundary");
  assert.ok(close > pane, "boundary closes after the pane");
});

test("the boundary is imported from the reader's pane-error-boundary module", () => {
  assert.match(source, /import \{ PaneErrorBoundary \} from "\.\/pane-error-boundary";/);
});
