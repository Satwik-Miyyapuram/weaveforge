/**
 * The log's calendar and Kinds card (design D19, DA-111): the count badge sat
 * half off its cell, nothing said what an outlined or shaded day meant, the
 * Kinds chips looked clickable and were not, and "Daily" was green on an
 * entry card but blue as a chip.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");
const css = read("app/styles/entity-detail.css");
const screen = read("features/logbook/ui/logbook-screen.tsx");
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

test("a kind is one colour on its card, its chip and its calendar day", () => {
  // The card wash reads the shared map (card-tint.css): daily is the "good"
  // step, weekly the "info" step. The chip rule has to agree.
  const positive = /\n([^\n{]*)\{ background: var\(--st-positive-bg\)/.exec(css)?.[1] ?? "";
  const info = /\n([^\n{]*)\{\n\s*background: var\(--st-info-bg\)/.exec(css)?.[1] ?? "";
  assert.match(positive, /\.status-daily\b/);
  assert.match(info, /\.status-weekly\b/);
  assert.doesNotMatch(info, /\.status-daily\b/);
  assert.match(rule(".log-calendar-day.is-logged"), /var\(--status-chip\)/, "a logged day takes its kind's colour");
});

test("the count sits inside its day", () => {
  const count = rule(".log-calendar-count");
  assert.doesNotMatch(count, /-\d+px/, "no negative offset pushes it out of the cell");
});

test("the calendar has a legend for its marks", () => {
  assert.match(screen, /className="log-calendar-legend"/);
  for (const mark of ["Daily", "Weekly", "Today"]) assert.match(screen, new RegExp(`>${mark}<`));
});

test("Kinds are filter chips that narrow the timeline", () => {
  assert.match(screen, /<LogKinds entries=\{entries\} active=\{kind\} onPick=\{setKind\} \/>/);
  assert.match(screen, /aria-pressed=\{active === k\}/);
  assert.match(screen, /kind \? entries\.filter\(\(e\) => e\.kind === kind\) : entries/);
  assert.match(screen, /setKind\(null\)/, "Clear filters clears the kind too");
});
