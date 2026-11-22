/**
 * The 0.9.7 move notice names a leftover secret by its Settings field text. Every legacy
 * secret key must map to a real label, and an unknown key must never show its raw name.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEGACY_SECRET_KEYS, settingsLabelFor } from "../providers/local/parts";

const RAW_NAME = /^[a-z][A-Za-z]*$/;

describe("settingsLabelFor", () => {
  it("gives every legacy secret key its Settings field text, never the raw name", () => {
    for (const key of LEGACY_SECRET_KEYS) {
      const label = settingsLabelFor(key);
      assert.notEqual(label, key, `${key} fell back to its raw name`);
      assert.doesNotMatch(label, RAW_NAME, `${key} shows a raw camelCase name: ${label}`);
    }
  });

  it("uses the Settings text for the keys that have a field", () => {
    assert.equal(settingsLabelFor("zoteroApiKey"), "Zotero key");
    assert.equal(settingsLabelFor("overleafToken"), "Overleaf git token");
    assert.equal(settingsLabelFor("gitSyncToken"), "Access token");
  });

  it("maps a sub-key to its top-level label", () => {
    assert.equal(settingsLabelFor("overleafToken.extra"), "Overleaf git token");
  });

  it("uses a generic label for a key with no Settings field", () => {
    assert.equal(settingsLabelFor("notesToken"), "a saved key");
    assert.equal(settingsLabelFor("someUnknownKey.sub"), "a saved key");
  });
});
