import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";

import { InkABToggle } from "../ui/ink-ab-toggle";

test("the A/B buttons are hidden unless the dev flag is on", () => {
  const html = renderToStaticMarkup(
    createElement(InkABToggle, { visible: false, renderer: "classic", onChange: () => {} }),
  );
  assert.equal(html, "");
});

test("with the flag on, A (classic) is pressed by default and B (freehand) is not", () => {
  const html = renderToStaticMarkup(
    createElement(InkABToggle, { visible: true, renderer: "classic", onChange: () => {} }),
  );
  assert.match(html, /aria-pressed="true"[^>]*>A</);
  assert.match(html, /aria-pressed="false"[^>]*>B</);
});

test("with the flag on and freehand chosen, B is pressed", () => {
  const html = renderToStaticMarkup(
    createElement(InkABToggle, { visible: true, renderer: "freehand", onChange: () => {} }),
  );
  assert.match(html, /aria-pressed="true"[^>]*>B</);
  assert.match(html, /aria-pressed="false"[^>]*>A</);
});
