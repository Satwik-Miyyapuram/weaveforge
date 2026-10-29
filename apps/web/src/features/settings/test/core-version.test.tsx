import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoreVersionView } from "../ui/core-version";

test("shows the core version", () => {
  const html = renderToStaticMarkup(createElement(CoreVersionView, { version: "1.2.3" }));
  assert.match(html, /Core 1\.2\.3/);
  assert.match(html, /data-testid="core-version"/);
});

test("renders nothing before the core has loaded", () => {
  assert.equal(renderToStaticMarkup(createElement(CoreVersionView, { version: null })), "");
});
