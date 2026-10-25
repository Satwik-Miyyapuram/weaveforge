import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResetShell } from "@/components/password-reset-screen";

test("the reset screen's status shell wraps its content in the card (13-18)", () => {
  const html = renderToStaticMarkup(createElement(ResetShell, { title: "Password changed" }, createElement("p", null, "body")));
  assert.equal(
    html,
    '<main class="app-shell"><div class="card crypto-setup-card"><h1 class="screen-title">Password changed</h1><p>body</p></div></main>',
  );
});
