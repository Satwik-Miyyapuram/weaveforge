import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { localOnlyEntryVisible, WEB_LOCAL_ONLY_ENTRY } from "@/lib/desktop/local-only-entry";

test("the web local-only entry stays hidden until the OPFS wiring lands", () => {
  assert.equal(WEB_LOCAL_ONLY_ENTRY, false);
  assert.equal(localOnlyEntryVisible(false), false);
});

test("the desktop local-only entry is always shown", () => {
  assert.equal(localOnlyEntryVisible(true), true);
});

test("neither login surface calls setLocalMode, and both route through the folder entry", () => {
  for (const rel of ["../ui/login-screen.tsx", "../ui/privacy-disclaimer-gate.tsx"]) {
    const source = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.equal(source.includes("setLocalMode("), false, `${rel} must not call setLocalMode`);
    assert.equal(source.includes("enterLocalOnly("), true, `${rel} must route through enterLocalOnly`);
  }
});
