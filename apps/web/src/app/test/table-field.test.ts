/**
 * Tables and forms share one look (design D15): sticky heads, icon sorting,
 * labelled empty headers, one control height, no unstyled tables or UA fieldsets.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const git = read("../styles/git.css");
const forms = read("../styles/forms.css");
const tokens = read("../../components/local-api-tokens.tsx");
const compare = read("../../features/experiments/ui/experiments-compare.tsx");
const papers = read("../../features/papers/ui/papers-table.tsx");

test("table heads stay in view and a keyboard-focused row shows", () => {
  assert.match(git, /\.cmp-table thead th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0/);
  assert.match(git, /\.cmp-table tbody tr:focus-within td\s*\{/);
});

test("sortable heads use the shared SortHeader, with no text arrows", () => {
  for (const [name, src] of [["compare", compare], ["papers", papers]] as const) {
    assert.match(src, /<SortHeader\b/, `${name} has its own sort header`);
    assert.doesNotMatch(src, /[▲▼↕]/, `${name} still draws text arrows`);
  }
});

test("no header cell is empty or named only by aria-label", () => {
  for (const [name, src] of [["compare", compare], ["papers", papers], ["tokens", tokens]] as const) {
    assert.doesNotMatch(src, /<th\b[^>]*\/>/, `${name} has an empty <th />`);
  }
});

test("the compare table shows status words, not raw keys", () => {
  assert.match(compare, /statusLabel\(e\.status\)/);
  assert.doesNotMatch(compare, /<td>\{e\.status\}<\/td>/);
});

test("the tokens page uses the styled table and no UA fieldset (E19, E20)", () => {
  assert.doesNotMatch(tokens, /data-table/);
  assert.match(tokens, /className="cmp-table"/);
  assert.doesNotMatch(tokens, /<fieldset/);
  assert.match(tokens, /role="group"/);
});

test("inputs and selects share the button height (DA-73)", () => {
  assert.match(forms, /input:not\(\[type="checkbox"\][^{]*\),\s*\.custom-select-button\s*\{[^}]*min-height:\s*var\(--control-lg\)/);
  assert.match(forms, /@media \(pointer: coarse\)\s*\{[^@]*\.custom-select-button\s*\{[^}]*min-height:\s*var\(--touch-min\)/);
});
