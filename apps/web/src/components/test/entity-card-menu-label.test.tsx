/** Each card's menu names its card, so a screen reader list of "More actions" is not twenty identical rows (DA-14). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EntityCardMenu } from "../entity-card-menu";

test("the menu trigger names the card it belongs to", () => {
  const out = renderToStaticMarkup(<EntityCardMenu shareable={false} name="ResNet" onDelete={() => {}} />);
  assert.match(out, /aria-label="More actions for ResNet"/);
});

test("without a name the trigger keeps the generic label", () => {
  const out = renderToStaticMarkup(<EntityCardMenu shareable={false} onDelete={() => {}} />);
  assert.match(out, /aria-label="More actions"/);
});
