import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { setContainerForTests } from "@/bootstrap";
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

test("a second token in the same screen redeems too, and clears the first error (P2-244)", async () => {
  const g = globalThis as { window?: unknown; self?: unknown };
  const had = { window: g.window, self: g.self };
  // next/link prefetches through self.requestIdleCallback.
  g.self = globalThis;
  // The loading screen rotates tips on window timers.
  g.window = { setInterval, clearInterval, setTimeout, clearTimeout };
  const calls: string[] = [];
  setContainerForTests({
    sharing: {
      redeemShareLink: async (token: string) => {
        calls.push(token);
        throw new Error(`Link ${token} has expired.`);
      },
    },
  } as never);
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  const tree = (search: string) =>
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams(search) as never },
        createElement(LinkRedeemScreen),
      ),
    );
  const settle = () => new Promise((r) => setTimeout(r, 5));
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => {
      renderer = create(tree("t=one"));
      await settle();
    });
    assert.match(JSON.stringify(renderer.toJSON()), /Link one has expired/);
    await act(async () => {
      renderer.update(tree("t=two"));
      await settle();
    });
    assert.deepEqual(calls, ["one", "two"]);
    const text = JSON.stringify(renderer.toJSON());
    assert.doesNotMatch(text, /Link one has expired/);
    assert.match(text, /Link two has expired/);
  } finally {
    act(() => renderer?.unmount());
    setContainerForTests(null);
    g.window = had.window;
    g.self = had.self;
  }
});