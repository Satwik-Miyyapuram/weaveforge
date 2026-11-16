/**
 * The notice and Settings rules for each shell phase, pure so no window is needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DesktopAppUpdate } from "@/lib/desktop/desktop-bridge";
import { appUpdateView } from "../application/app-update-view";

const base: DesktopAppUpdate = { phase: "idle", current: "0.9.1", version: null, percent: null, error: null };
const at = (patch: Partial<DesktopAppUpdate>): DesktopAppUpdate => ({ ...base, ...patch });

test("an available release shows the one-click notice and an install button", () => {
  const view = appUpdateView(at({ phase: "available", version: "0.9.2" }));
  assert.equal(view.notice, "WeaveForge 0.9.2 is ready — Restart to update");
  assert.equal(view.canInstall, true);
  assert.equal(view.installLabel, "Update now");
  assert.equal(view.canCheck, true);
  assert.equal(view.error, null);
});

test("a download shows its percentage and offers no button", () => {
  const view = appUpdateView(at({ phase: "downloading", version: "0.9.2", percent: 40 }));
  assert.match(view.notice ?? "", /Downloading WeaveForge 0\.9\.2 \(40%\)/);
  assert.equal(view.canInstall, false);
  assert.equal(view.canCheck, false);
});

test("a download without a known size shows no percentage", () => {
  const view = appUpdateView(at({ phase: "downloading", version: "0.9.2", percent: null }));
  assert.equal(view.notice, "Downloading WeaveForge 0.9.2");
});

test("an install in progress says the window will restart and offers nothing", () => {
  const view = appUpdateView(at({ phase: "installing", version: "0.9.2" }));
  assert.match(view.notice ?? "", /will restart/);
  assert.equal(view.canInstall, false);
  assert.equal(view.canCheck, false);
});

test("a failed install keeps the release, offers a retry, and says what failed", () => {
  const view = appUpdateView(
    at({ phase: "failed", version: "0.9.2", error: "The update did not install. Try again." }),
  );
  assert.equal(view.notice, "WeaveForge 0.9.2 did not install.");
  assert.equal(view.error, "The update did not install. Try again.");
  assert.equal(view.canInstall, true);
  assert.equal(view.installLabel, "Try again");
  assert.equal(view.canCheck, true);
});

test("a failed check is an error with no install and a check to retry", () => {
  const view = appUpdateView(at({ phase: "failed", error: "Could not check for an update." }));
  assert.equal(view.notice, null);
  assert.equal(view.error, "Could not check for an update.");
  assert.equal(view.canInstall, false);
  assert.equal(view.canCheck, true);
  assert.ok(!view.summary.includes("latest version"), "a failure never reads as up to date");
});

test("a failure without a message still says it failed", () => {
  const view = appUpdateView(at({ phase: "failed", error: null }));
  assert.match(view.error ?? "", /Try again/);
});

test("up to date says so, and nothing is offered", () => {
  const view = appUpdateView(at({ phase: "upToDate" }));
  assert.equal(view.summary, "You have the latest version.");
  assert.equal(view.notice, null);
  assert.equal(view.canInstall, false);
  assert.equal(view.canCheck, true);
});

test("an unsupported build cannot check or install and shows no notice", () => {
  const view = appUpdateView(at({ phase: "unsupported" }));
  assert.equal(view.canCheck, false);
  assert.equal(view.canInstall, false);
  assert.equal(view.notice, null);
  assert.match(view.summary, /not set up/);
});

test("a check in progress blocks a second check", () => {
  assert.equal(appUpdateView(at({ phase: "checking" })).canCheck, false);
});
