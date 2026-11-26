/**
 * The privacy copy must match what the app does (review P1-7): no encryption
 * claims (nothing is encrypted at rest by us, and there is no E2E), the
 * account copy names GitHub sync and does not say everything sits on the
 * server, shares are view/comment only, and PDF text can reach the model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  PRIVACY_DISCLAIMER_PARAGRAPHS,
  PRIVACY_DISCLAIMER_SUMMARY,
  PRIVACY_LOCAL_PARAGRAPHS,
} from "../privacy-disclaimer";

const account = [...PRIVACY_DISCLAIMER_SUMMARY, ...PRIVACY_DISCLAIMER_PARAGRAPHS].join("\n");
const local = PRIVACY_LOCAL_PARAGRAPHS.join("\n");
const all = `${account}\n${local}`;

test("no copy claims encryption", () => {
  assert.doesNotMatch(all, /encrypt/i);
});

test("account copy does not say all content is stored on the server", () => {
  assert.doesNotMatch(account, /papers, notes, and files are stored on the server/i);
});

test("account copy names GitHub sync and what still reaches the server with it", () => {
  assert.match(account, /GitHub/);
  assert.match(account, /shared/i);
});

test("shares are described as view or comment, never edit", () => {
  assert.doesNotMatch(account, /comment\/edit/i);
});

test("AI copy no longer says PDF text is never sent", () => {
  assert.doesNotMatch(account, /PDFs[^.]*never sent/i);
  assert.match(account, /text of a PDF/i);
});

test("security docs and README do not claim data is encrypted at rest", () => {
  const repo = new URL("../../../../../../", import.meta.url);
  for (const file of ["SECURITY.md", "docs/SECURITY.md", "README.md"]) {
    const text = readFileSync(new URL(file, repo), "utf8");
    assert.doesNotMatch(text, /(stored|data)[^.]*with (the database's )?encryption at rest/i, file);
    assert.match(text, /no encryption at rest of its own|does not encrypt/i, file);
  }
});

test("local backup advice mentions GitHub sync", () => {
  assert.match(local, /or turn on GitHub sync/);
});
