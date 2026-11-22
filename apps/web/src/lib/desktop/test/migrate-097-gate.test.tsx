import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Migrate097Gate } from "../migrate-097-gate";
import { shouldShowFinishRemoving, shouldShowRetry, shouldShowUpgrade } from "../migrate-097-gate-decision";

const FOLDER = "C:\\Users\\me\\Documents\\WeaveForge";

test("only an incomplete migration in an open folder shows the upgrade screen", () => {
  assert.equal(shouldShowUpgrade("incomplete", FOLDER), true);
  assert.equal(shouldShowUpgrade("none", FOLDER), false, "nothing to upgrade on a fresh folder");
  assert.equal(shouldShowUpgrade("verified", FOLDER), false, "a verified folder needs no screen");
  assert.equal(shouldShowUpgrade("unavailable", FOLDER), false, "an unanswered read shows nothing");
  assert.equal(shouldShowUpgrade("incomplete", null), false, "no folder, no upgrade");
});

test("any state that leaves the window read-only or unknown shows a Retry banner", () => {
  for (const state of ["unavailable", "removing-other", "incomplete"] as const) {
    assert.equal(shouldShowRetry(state, FOLDER), true, `${state} must offer Retry`);
  }
  for (const state of ["none", "verified", "removed", "removing"] as const) {
    assert.equal(shouldShowRetry(state, FOLDER), false, `${state} needs no Retry`);
  }
  assert.equal(shouldShowRetry("unavailable", null), false, "no folder, nothing to retry");
});

test("only this device's own removal offers Finish removing", () => {
  assert.equal(shouldShowFinishRemoving("removing", FOLDER), true);
  for (const state of ["removing-other", "unavailable", "incomplete", "verified", "removed", "none"] as const) {
    assert.equal(shouldShowFinishRemoving(state, FOLDER), false, `${state} must not offer Finish removing`);
  }
  assert.equal(shouldShowFinishRemoving("removing", null), false, "no folder, nothing to finish");
});

test("outside the desktop shell the gate renders its children and no upgrade screen", () => {
  const html = renderToStaticMarkup(
    <Migrate097Gate>
      <p>workspace</p>
    </Migrate097Gate>,
  );
  assert.equal(html, "<p>workspace</p>");
});
