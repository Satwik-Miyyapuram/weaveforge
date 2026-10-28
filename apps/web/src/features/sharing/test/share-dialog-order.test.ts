/**
 * The share dialog put the public link between the people it is shared with
 * and the picker to add more, the access select sat apart from the people with
 * no name, and nothing said what view, comment and edit allow (design D22,
 * DA-144). People come first, the link folds away below, and the select is
 * labelled "Permission" with a line explaining each role.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../ui/${rel}`, import.meta.url)), "utf8");
const dialog = read("share-dialog.tsx");
const panel = read("share-link-panel.tsx");

test("people come first, the public link last", () => {
  const current = dialog.indexOf('className="share-current"');
  const add = dialog.indexOf('className="share-add"');
  const link = dialog.indexOf("<ShareLinkPanel");
  assert.ok(current > 0 && add > current && link > add, "current, add, then link");
});

test("the public link is folded away", () => {
  assert.match(panel, /<details className="share-links-fold">\s*<summary className="settings-group">/);
  assert.match(panel, /Public link\{links\.length > 0 \? ` \(\$\{links\.length\} active\)` : ""\}/);
  assert.doesNotMatch(panel, /<h4 className="settings-group">Public link<\/h4>/);
});

test("the access select is a labelled Permission with help", () => {
  assert.match(dialog, /<label htmlFor="share-permission">Permission<\/label>/);
  assert.match(dialog, /id="share-permission"/);
  assert.doesNotMatch(dialog, /aria-label="Access level"/);
  assert.match(dialog, /View can read\. Comment can read and comment\./);
  assert.match(dialog, /supportsEdit \? " Edit can change it too\." : ""/);
});
