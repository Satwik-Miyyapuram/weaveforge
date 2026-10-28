/**
 * Settings said "Stored in this browser" and "straight from this browser" in
 * the desktop app, which has no browser the reader would recognise. Settings
 * kept on the machine say "this device", in both builds (design D21, DA-137).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../ui/${rel}`, import.meta.url)), "utf8");

test("the editor and AI provider settings say this device, not this browser", () => {
  const editor = read("editor-settings-panel.tsx");
  assert.match(editor, /Stored on this device alongside your theme\./);
  assert.doesNotMatch(editor, /Stored in this browser/);
  const provider = read("ai-provider-panel.tsx");
  assert.doesNotMatch(provider, /from this browser/);
  assert.match(provider, /Calls go\s+straight from this device to the provider/);
});
