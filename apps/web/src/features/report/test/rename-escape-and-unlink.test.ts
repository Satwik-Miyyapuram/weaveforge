/**
 * Escape while renaming a section must not commit the typed title on blur, and a
 * double click on Confirm in the Overleaf unlink must fire one delete, not two.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const section = readFileSync(fileURLToPath(new URL("../ui/section-card.tsx", import.meta.url)), "utf8");
const overleaf = readFileSync(fileURLToPath(new URL("../ui/overleaf-project-detail.tsx", import.meta.url)), "utf8");

test("Escape in the rename input marks the rename cancelled before closing", () => {
  assert.match(section, /if \(e\.key === "Escape"\) \{\s*cancelled\.current = true;\s*setRenaming\(false\);\s*\}/);
});

test("finishRename returns early without saving when the rename was cancelled", () => {
  assert.match(section, /if \(cancelled\.current \|\| !title \|\| title === s\.title\) return;/);
});

test("Confirm unlink is guarded by a busy ref and disabled while busy", () => {
  assert.match(overleaf, /const unlinkBusy = useRef\(false\);/);
  assert.match(overleaf, /if \(unlinkBusy\.current\) return;/);
  assert.match(overleaf, /disabled=\{unlinking\}/);
});

test("the unlink busy flag is reset in finally", () => {
  const body = overleaf.slice(overleaf.indexOf("async function confirmUnlinkOnce"));
  assert.match(body.slice(0, body.indexOf("\n  }\n")), /finally \{\s*unlinkBusy\.current = false;/);
});
