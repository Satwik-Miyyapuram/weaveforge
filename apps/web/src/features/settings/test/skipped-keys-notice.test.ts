/**
 * Saved keys the keychain could not read are named in Settings so the reader can
 * type them again. Only the key names are shown, never a value.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceSecretsStore, type DeviceKeychain } from "@/backend/device-secrets-store";
import { DEVICE_KEYS_LINE, SkippedKeysNoticeView, skippedKeysOf, skippedKeysText } from "@/features/settings/ui/skipped-keys-notice";

test("the device keys line names the system keychain, not a file", () => {
  assert.match(DEVICE_KEYS_LINE, /system keychain \(Windows Credential Manager, the macOS keychain, Secret Service on Linux, or the Android Keystore\)/);
  assert.match(DEVICE_KEYS_LINE, /Signing in does not move them to your account\./);
  assert.doesNotMatch(DEVICE_KEYS_LINE, /folder|file permissions/);
});

test("no skipped keys shows nothing", () => {
  assert.equal(skippedKeysText([]), null);
  assert.equal(renderToStaticMarkup(createElement(SkippedKeysNoticeView, { skipped: [] })), "");
});

test("one skipped key reads in the singular", () => {
  assert.equal(skippedKeysText(["zoteroApiKey"]), "1 saved key could not be read; re-enter them in Settings: zoteroApiKey.");
});

test("several skipped keys are counted once each and named", () => {
  assert.equal(
    skippedKeysText(["zoteroApiKey", "integrations.p1", "zoteroApiKey"]),
    "2 saved keys could not be read; re-enter them in Settings: zoteroApiKey, integrations.p1.",
  );
});

test("the notice names the unreadable keys and shows no value, read or broken", async () => {
  const entries = new Map(Object.entries({
    _index: JSON.stringify({ source: "save", keys: ["zoteroApiKey", "integrations.p1", "integrations.p2"] }),
    "integrations.p1": "{broken-SECRET-ONE",
    "integrations.p2": '{"token":"SECRET-TWO"}',
  }));
  const keychain: DeviceKeychain = {
    read: async (key) => entries.get(key) ?? null,
    write: async () => undefined,
    clear: async () => undefined,
  };
  const warn = console.warn;
  console.warn = () => undefined;
  let loaded: unknown;
  try {
    loaded = await skippedKeysOf(new DeviceSecretsStore(keychain))();
  } finally {
    console.warn = warn;
  }
  // The loader hands on the names alone, so no value can reach the screen.
  assert.deepEqual(loaded, { skipped: ["zoteroApiKey", "integrations.p1"] });
  const html = renderToStaticMarkup(createElement(SkippedKeysNoticeView, (loaded as { skipped: string[] })));
  assert.match(html, /2 saved keys could not be read; re-enter them in Settings: zoteroApiKey, integrations\.p1\./);
  assert.doesNotMatch(html, /SECRET/);
});
