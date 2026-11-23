// The Integrations tab says where API keys live. On the desktop they are OS
// keychain entries (DeviceSecretsStore), not files in the app's folder; the
// browser keeps none (RefusingSecretsStore). SettingsScreen has no render
// harness, so this pins the copy in the source, like settings-edge-guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../ui/settings-screen.tsx", import.meta.url), "utf8");

test("the desktop says keys are kept in this computer's keychain", () => {
  assert.match(src, /Keys are kept in this computer&rsquo;s keychain\./);
  assert.doesNotMatch(src, /app&rsquo;s own folder|file\s+permissions/);
});

test("the browser says keys can't be saved there", () => {
  assert.match(src, /API keys can&rsquo;t be saved in the browser in this version\./);
});
