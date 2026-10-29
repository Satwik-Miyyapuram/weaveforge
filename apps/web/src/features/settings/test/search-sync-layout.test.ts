/**
 * Search settings stacked six full-width sliders, the sync panel printed
 * "Last checked 26/10/2026, 01:49:19", and "Sync now" stretched across the
 * card (design D21, DA-138, D-01).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");
const css = read("app/styles/settings.css");

test("the field weights sit in two compact columns", () => {
  const panel = read("features/settings/ui/search-settings-panel.tsx");
  assert.match(panel, /<div className="search-weights">\s*\{\(Object\.keys\(FIELD_LABELS\)/);
  assert.match(css, /@media \(min-width: 640px\) \{ \.search-weights \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/);
});

test("the sync panel dates its last check without seconds", () => {
  const sync = read("features/offline-sync/ui/sync-settings-panel.tsx");
  assert.match(sync, /Last checked \$\{formatDateTime\(status\.lastPullAt\)\}/);
  assert.doesNotMatch(sync, /toLocale(String|TimeString)/);
});

test("a settings block's button is as wide as its label", () => {
  assert.match(css, /\.settings-block > \.wf-btn \{ align-self: flex-start; \}/);
});
