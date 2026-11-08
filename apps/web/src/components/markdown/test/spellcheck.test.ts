/** The note editor's spell check setting. */
import assert from "node:assert/strict";
import test from "node:test";
import { setSpellcheck, spellcheckAttrs, spellcheckOn } from "../spellcheck";

test("on by default", () => {
  assert.equal(spellcheckOn(), true);
  assert.deepEqual(spellcheckAttrs(), { spellcheck: "true" });
});

test("turning it off tells the editor's content element", () => {
  setSpellcheck(false);
  assert.equal(spellcheckOn(), false);
  assert.deepEqual(spellcheckAttrs(), { spellcheck: "false" });
  setSpellcheck(true);
  assert.equal(spellcheckOn(), true);
});
