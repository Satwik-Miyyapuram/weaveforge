/** Outside URLs skip next/link, whose prefetch only runs in a browser. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";

import { Anchor, isOutside } from "../anchor";

test("a scheme marks an outside URL; a route does not", () => {
  for (const href of ["https://doi.org/x", "mailto:a@b.c", "HTTP://x"]) assert.equal(isOutside(href), true, href);
  for (const href of ["/notes", "notes?x=1", "#top", ""]) assert.equal(isOutside(href), false, href);
});

test("an outside link renders as a plain anchor and mounts without a browser", async () => {
  let r: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    r = TestRenderer.create(<Anchor href="https://doi.org/x" target="_blank">x</Anchor>);
  });
  assert.equal(r!.root.findByType("a").props.href, "https://doi.org/x");
  assert.match(renderToStaticMarkup(<Anchor href="/notes" className="wf-link">n</Anchor>), /<a class="wf-link" href="\/notes">n<\/a>/);
});
