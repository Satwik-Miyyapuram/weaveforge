import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { LinkRedeemScreen } from "../ui/link-redeem-screen";

/**
 * Opening /link without its token showed one red line, "Missing link token.",
 * and nothing else: no explanation and no way back. It now says what a share
 * link is and offers the way home, in the same empty state other screens use.
 */

function render(search: string): string {
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams(search) as never },
        createElement(LinkRedeemScreen),
      ),
    ),
  );
}

test("a link without its token explains itself and offers the way home", () => {
  const html = render("");
  assert.doesNotMatch(html, /Missing link token/);
  assert.match(html, /class="empty empty--first-run"/);
  assert.match(html, /class="empty-mark"/);
  assert.match(html, /<h3 class="empty-title">This link is incomplete<\/h3>/);
  assert.match(html, /href="\/"/);
});

test("a link with its token shows the shared loading screen", () => {
  const html = render("t=abc");
  assert.match(html, /class="screen screen-loading" aria-busy="true"/);
  assert.match(html, /Preparing shared link…|Opening shared item…/);
});
