/**
 * Settings sections sit straight on the page, not inside cards: the settings
 * area is already framed, so a card around each section is a box in a box.
 * Covers every panel that only renders in Settings.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const features = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const settingsUi = path.join(features, "settings", "ui");
const files = [
  ...readdirSync(settingsUi).filter((f) => f.endsWith(".tsx")).map((f) => path.join(settingsUi, f)),
  path.join(features, "sync", "ui", "sync-settings.tsx"),
  path.join(features, "offline-sync", "ui", "sync-issues-panel.tsx"),
  path.join(features, "offline-sync", "ui", "sync-settings-panel.tsx"),
  path.join(features, "org", "ui", "org-screen.tsx"),
];

// The bare `card` class; `theme-card` or `card-tint` are other classes.
const CARD = /className=["`{][^"`}]*(?<![\w-])card(?![\w-])/;

test("Settings panels use no card class", () => {
  const offenders = files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((line, i) => (CARD.test(line) ? `${path.relative(features, file)}:${i + 1}` : ""))
      .filter(Boolean),
  );
  assert.deepEqual(offenders, []);
});

test("no theme rule styles a card inside Settings", () => {
  const css = readFileSync(path.join(features, "..", "app", "styles", "brutal.css"), "utf8");
  assert.doesNotMatch(css, /\.settings-body\s*>\s*(?:\[role="tabpanel"\]\s*>\s*)?\.card/);
});
