/** The MyScript key round-trips through `integrations.myscript` and leaves nothing behind when cleared. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { myScriptKeyOf, withMyScriptKey } from "../ui/ink-settings-panel";

test("setting a key writes integrations.myscript.applicationKey, trimmed", () => {
  const next = withMyScriptKey({}, "  abc  ");
  assert.equal(myScriptKeyOf(next), "abc");
  assert.deepEqual(next.integrations, { myscript: { applicationKey: "abc" } });
});

test("clearing the key removes the record, keeping other integrations and myscript fields", () => {
  const start = withMyScriptKey({ integrations: { zotero: { apiKey: "z" }, myscript: { host: "h" } } }, "k");
  const cleared = withMyScriptKey(start, "");
  assert.deepEqual(cleared.integrations, { zotero: { apiKey: "z" }, myscript: { host: "h" } });
  assert.equal(myScriptKeyOf(cleared), "");
  assert.equal("integrations" in withMyScriptKey({}, ""), false);
});
