/**
 * A draft the review queue refuses must not hide the ones it took. The import
 * throws once every draft is tried, and the inbox used to swallow that: the
 * suggestions that did land were never announced and the person never heard
 * that one is waiting in the folder (E14).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../ui/folder-draft-inbox.tsx", import.meta.url)), "utf8");

test("a failed import is not swallowed", () => {
  assert.doesNotMatch(src, /\.catch\(\(\) => undefined\)/);
});

test("a failed import still announces what landed and tells the person", () => {
  const onError = src.slice(src.indexOf(".catch("));
  assert.match(onError, /announceAiProposalsChanged\(/);
  assert.match(onError, /showToast\(/);
});
