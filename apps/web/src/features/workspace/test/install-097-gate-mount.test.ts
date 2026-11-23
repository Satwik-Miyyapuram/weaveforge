/**
 * Static check: the install gate sits at the app root and wraps the auth provider, so nothing
 * below it (auth, boot, shell, pages) mounts while the gate blocks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const layout = readFileSync(fileURLToPath(new URL("../../../app/layout.tsx", import.meta.url)), "utf8");

test("layout imports the install gate", () => {
  assert.match(layout, /import \{ Install097Gate \} from "@\/features\/workspace\/ui\/install-097-gate";/);
});

test("the gate opens before AuthProvider and closes after it", () => {
  const open = layout.indexOf("<Install097Gate>");
  const auth = layout.indexOf("<AuthProvider>");
  const authEnd = layout.indexOf("</AuthProvider>");
  const close = layout.indexOf("</Install097Gate>");
  assert.ok(open > -1 && auth > open, "gate opens before AuthProvider");
  assert.ok(close > authEnd && authEnd > auth, "gate closes after AuthProvider");
});
