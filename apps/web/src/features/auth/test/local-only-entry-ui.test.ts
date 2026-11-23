import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { LOCAL_MODE_IN_BUILD } from "@/backend/providers/local/local-identity";
import { localOnlyEntryVisible, WEB_LOCAL_ONLY_ENTRY } from "@/lib/desktop/local-only-entry";

test("the web local-only entry stays hidden until the OPFS wiring lands", () => {
  assert.equal(WEB_LOCAL_ONLY_ENTRY, false);
  assert.equal(localOnlyEntryVisible(false), false);
});

test("offline mode is in the 0.9.7 build: the entry shows on desktop and stays hidden on web", () => {
  assert.equal(LOCAL_MODE_IN_BUILD, true);
  assert.equal(localOnlyEntryVisible(true), true);
  assert.equal(localOnlyEntryVisible(false), false);
});

test("both login surfaces ask localOnlyEntryVisible before showing the local-only button", () => {
  for (const rel of ["../ui/login-screen.tsx", "../ui/privacy-disclaimer-gate.tsx"]) {
    const source = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.equal(source.includes("localOnlyEntryVisible("), true, `${rel} must gate the button on localOnlyEntryVisible`);
  }
});

test("neither login surface calls setLocalMode, and both route through the folder entry", () => {
  for (const rel of ["../ui/login-screen.tsx", "../ui/privacy-disclaimer-gate.tsx"]) {
    const source = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.equal(source.includes("setLocalMode("), false, `${rel} must not call setLocalMode`);
    assert.equal(source.includes("enterLocalOnly("), true, `${rel} must route through enterLocalOnly`);
  }
});

test("both login surfaces hand the folder entry the shell's exporter, so a folder that needs the export can run it", () => {
  for (const rel of ["../ui/login-screen.tsx", "../ui/privacy-disclaimer-gate.tsx"]) {
    const source = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.equal(source.includes("enterLocalOnly(shell, desktopRunExport(shell))"), true, `${rel} must pass desktopRunExport`);
  }
});

test("the gate's offline button answers an unavailable outcome with its own message, not the login copy", () => {
  const gate = readFileSync(new URL("../ui/privacy-disclaimer-gate.tsx", import.meta.url), "utf8");
  assert.equal(gate.includes('outcome === "unavailable"'), true, "the gate must handle the unavailable outcome");
  assert.equal(
    gate.includes("cannot open a workspace folder"),
    false,
    "the gate must not reuse the login-screen error text",
  );
});
