/**
 * The Overleaf read, from the shell's side.
 *
 * The clone itself belongs to the web app's module and is tested there. What
 * is worth checking here is the division: that the page cannot name the token,
 * that a machine with nothing stored is told so rather than shown a git error,
 * and that arguments which are not strings are refused before anything dials.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { handleOverleafRead } from "../src/overleaf-source";

const noToken = async () => ({ ok: true, value: null }) as const;

test("overleaf: nothing stored is a sentence, not a git failure", async () => {
  const result = await handleOverleafRead("abc", "main.tex", noToken);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /No Overleaf token is stored/);
});

test("overleaf: a non-string argument never reaches the network", async () => {
  let asked = false;
  const result = await handleOverleafRead(42, "main.tex", async () => {
    asked = true;
    return { ok: true, value: "tok" } as const;
  });
  assert.equal(result.ok, false);
  assert.equal(asked, false, "the token must not even be read for a malformed call");
});

test("overleaf: a refused keychain read is passed through as its own reason", async () => {
  const result = await handleOverleafRead("abc", "main.tex", async () => ({
    ok: false,
    message: "This machine has no keychain available",
  }));
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.message, /no keychain/);
});
