import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import type { SharedItemDetail } from "../application/load-shared-details";
import { SharedItemRenderer } from "../ui/shared-item-renderer";

/**
 * The non-paper share cards share one shell (33-21): the card, the tags, the
 * title with its "Shared by" chip, and a foot that always ends in Open. What
 * differs per kind is the body and which foot buttons come first.
 */

const base = { ownerId: "owner-1", canComment: false } as const;

const ITEMS: Record<string, SharedItemDetail> = {
  vault: {
    ...base,
    kind: "vault_page",
    id: "v1",
    title: "Notes",
    vaultPage: { id: "v1", title: "Notes", body: "Some   body text", sortOrder: 0, createdAt: "", updatedAt: "" },
  } as unknown as SharedItemDetail,
  experiment: {
    ...base,
    kind: "experiment",
    id: "e1",
    title: "Run",
    experiment: { id: "e1", name: "Run", hypothesis: "It works", metrics: { acc: 0.22 } },
  } as unknown as SharedItemDetail,
  milestone: { ...base, kind: "milestone", id: "m1", title: "Ship", status: "open" } as unknown as SharedItemDetail,
};

function render(item: SharedItemDetail): string {
  // The copy button reads the router; a stub one is enough to render.
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(SharedItemRenderer, { item, ownerName: "Ada", canComment: true }),
    ),
  );
}

for (const [name, item] of Object.entries(ITEMS)) {
  test(`${name} share card keeps the shared shell (33-21)`, () => {
    const html = render(item);
    assert.match(html, /^<li class="card exp-item shared-item">/);
    assert.match(html, /<div class="card-head"><h3 class="card-title">[^<]+<\/h3><span class="shared-by-chip"><span class="wf-chip">Shared by Ada<\/span><\/span><\/div>/);
    assert.match(html, /<span class="shared-access">Can comment<\/span>/);
    assert.match(html, /<div class="card-foot shared-item-foot">.*aria-label="Open".*<\/div><\/li>$/);
  });
}

test("each kind keeps its own body and foot buttons (33-21)", () => {
  assert.match(render(ITEMS.vault!), /<p class="muted">Some body text<\/p>/);
  assert.match(render(ITEMS.experiment!), /<p class="muted">It works<\/p>.*<em>acc<\/em>/);
  assert.match(render(ITEMS.milestone!), /<em>status<\/em> open/);
});
