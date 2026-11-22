import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Migrate097Gate } from "../migrate-097-gate";
import { shouldShowUpgrade } from "../migrate-097-gate-decision";

const FOLDER = "C:\\Users\\me\\Documents\\WeaveForge";

test("only an incomplete migration in an open folder shows the upgrade screen", () => {
  assert.equal(shouldShowUpgrade("incomplete", FOLDER), true);
  assert.equal(shouldShowUpgrade("none", FOLDER), false, "nothing to upgrade on a fresh folder");
  assert.equal(shouldShowUpgrade("verified", FOLDER), false, "a verified folder needs no screen");
  assert.equal(shouldShowUpgrade("unavailable", FOLDER), false, "an unanswered read shows nothing");
  assert.equal(shouldShowUpgrade("incomplete", null), false, "no folder, no upgrade");
});

test("outside the desktop shell the gate renders its children and no upgrade screen", () => {
  const html = renderToStaticMarkup(
    <Migrate097Gate>
      <p>workspace</p>
    </Migrate097Gate>,
  );
  assert.equal(html, "<p>workspace</p>");
});
