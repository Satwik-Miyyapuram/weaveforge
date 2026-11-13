// Source-match checks for session-expired dialog and password reset edge cases.
// Each test pins one fix: Escape closes the dialog, focus moves in on open,
// the expired-link branch has a way back, and submit is guarded against double runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appShell = readFileSync(new URL("../app-shell.tsx", import.meta.url), "utf8");
const resetScreen = readFileSync(new URL("../../components/password-reset-screen.tsx", import.meta.url), "utf8");

test("session expired dialog closes on Escape", () => {
  assert.match(appShell, /window\.addEventListener\("keydown"/);
  assert.match(appShell, /event\.key === "Escape"\) setOpen\(false\)/);
});

test("session expired dialog moves focus into itself on open", () => {
  assert.match(appShell, /dialogRef = useRef<HTMLDivElement>/);
  assert.match(appShell, /querySelector<HTMLElement>\("button, a, input"\)\?\.focus\(\)/);
});

test("expired reset link branch links back to sign in", () => {
  assert.match(resetScreen, /<Button variant="link" href="\/">Back to sign in<\/Button>/);
});

test("reset submit is guarded against double runs", () => {
  assert.match(resetScreen, /const busyRef = useRef\(false\)/);
  assert.match(resetScreen, /if \(busyRef\.current\) return;/);
  assert.match(resetScreen, /busyRef\.current = false;\n\s*setBusy\(false\);/);
});
