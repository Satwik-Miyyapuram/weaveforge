/**
 * A note whose ink cannot be loaded or saved says so where the user is looking.
 *
 * The message used to render only inside the text layer, which is collapsed
 * while writing, so a page that never saved showed nothing but "Unsaved".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { InkStoreAlert } from "../ui/ink-store-alert";
import { INK_SAVE_FAILED } from "../ui/use-ink-note-store";

test("a store failure renders as an alert with its message", () => {
  const html = renderToStaticMarkup(<InkStoreAlert message={INK_SAVE_FAILED} />);
  assert.match(html, /role="alert"/);
  assert.ok(html.includes("could not be saved"));
});

test("no failure renders nothing", () => {
  assert.equal(renderToStaticMarkup(<InkStoreAlert message={null} />), "");
});

test("the ink host shows the store's error outside the text layer", () => {
  const src = readFileSync(fileURLToPath(new URL("../ui/ink-host.tsx", import.meta.url)), "utf8");
  assert.match(src, /<InkStoreAlert message=\{loadError\}/);
  assert.ok(!src.includes("unavailable={loadError ?? unavailable}"), "the text layer no longer carries it alone");
});
