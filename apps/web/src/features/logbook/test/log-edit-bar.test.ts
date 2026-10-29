/**
 * Editing a long log entry (design D19, DA-109): Done sat ~650 px below the
 * fold, the Kind select, Cancel and Done were three heights (31/34/36), and
 * the field still asked "What did you do?" as if the entry were new.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");

test("the edit form is labelled Edit entry", () => {
  const screen = read("features/logbook/ui/logbook-screen.tsx");
  assert.match(screen, /<label id=\{`body-\$\{entry\.id\}`\}>Edit entry<\/label>/);
  assert.match(read("features/logbook/ui/add-log-entry-form.tsx"), />What did you do\?</, "a new entry keeps its question");
});

test("Cancel and Done stay in view while the entry scrolls", () => {
  const screen = read("features/logbook/ui/logbook-screen.tsx");
  assert.match(screen, /className="card-foot edit-actions log-edit-bar"/);
  const rule = /\.log-edit-bar \{([^}]*)\}/.exec(read("app/styles/entity-detail.css"))?.[1] ?? "";
  assert.match(rule, /position:\s*sticky/);
  assert.match(rule, /bottom:\s*0/);
  assert.match(rule, /background:\s*var\(--/, "a see-through bar shows the text under it");
  assert.match(rule, /z-index:\s*var\(--z-sticky\)/);
});

test("a select is as tall as the buttons beside it", () => {
  const css = read("app/styles/forms.css");
  const rules = [...css.matchAll(/(^|\n)\.custom-select-button \{([^}]*)\}/g)].map((m) => m[2] ?? "");
  for (const rule of rules) {
    assert.doesNotMatch(rule, /padding:\s*12px 12px/, "block padding pushes the select past --control-lg");
  }
});
