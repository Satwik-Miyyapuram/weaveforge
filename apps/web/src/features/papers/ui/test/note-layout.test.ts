/**
 * A note's page keeps one layout in every mode (design D19, DA-105). Edit used
 * to drop the side column, so switching Read → Edit jumped the text sideways,
 * while Ink kept it; and the editor was a fixed 78vh box, so one line of text
 * sat in a 665 px frame.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), "utf8");

test("Edit keeps the side column on the paper note and the wiki page", () => {
  for (const file of ["features/papers/ui/paper-note.tsx", "features/vault/ui/vault-screen/page-editor.tsx"]) {
    assert.doesNotMatch(read(file), /record-grid--editing/, file);
  }
  assert.doesNotMatch(read("app/styles/record.css"), /record-grid--editing/);
});

test("the editor on a record page grows from about eight lines", () => {
  const css = read("app/styles/record.css");
  const rule = /\.record-doc--edit \.md-live \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /min-height:\s*calc\(8 \* 1\.75em\)/);
  assert.match(rule, /max-height:\s*min\(78vh, 1100px\)/);
  assert.doesNotMatch(rule, /(^|[^-])height:/, "a fixed height boxes one line in 665 px");
});
