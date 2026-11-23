// The Integrations tab says where API keys live. On the desktop they are OS
// keychain entries (DeviceSecretsStore), not files in the app's folder; the
// browser keeps none (RefusingSecretsStore). SettingsScreen has no render
// harness, so this pins the copy in the source, like settings-edge-guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEVICE_KEYS_LINE } from "../ui/skipped-keys-notice";

const src = readFileSync(new URL("../ui/settings-screen.tsx", import.meta.url), "utf8");

test("the desktop says keys are kept in the system keychain", () => {
  // The line itself lives in skipped-keys-notice (DEVICE_KEYS_LINE, pinned there).
  assert.match(src, /\{DEVICE_KEYS_LINE\}/);
  assert.match(DEVICE_KEYS_LINE, /Keys are kept in this device's system keychain/);
  assert.doesNotMatch(src, /app&rsquo;s own folder|file\s+permissions/);
});

test("the browser says keys can't be saved there", () => {
  assert.match(src, /API keys can&rsquo;t be saved in the browser in this version\./);
});
