import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { JumpToCreateRow } from "../jump-to-create-row";

const render = (query: string) => renderToStaticMarkup(createElement(JumpToCreateRow, { query, onCreate: () => {} }));

test("a blank query offers no create row (12-04)", () => {
  assert.equal(render(""), "");
  assert.equal(render("   \t"), "");
});

test("a query offers to create the note it names, trimmed", () => {
  const html = render("  Methods  ");
  assert.match(html, /Create note “Methods”/);
  assert.match(html, /class="jump-to-create"/);
});
