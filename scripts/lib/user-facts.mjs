/**
 * Facts the user docs (`docs/using`) state that the code already knows.
 *
 * Each builder reads the constant the app itself uses, so a changed limit or a
 * new dashboard card makes `check:docs` fail until the page is regenerated. The
 * parsers take source text and throw when what they look for is gone: a rename
 * then breaks the docs build instead of leaving the old number on the page.
 */

import { read } from "./repo-stats.mjs";

/** The value of `const NAME: type = value;` in Rust source. */
export function rustConst(src, name) {
  const match = src.match(new RegExp(`const ${name}: \\w+ = ([0-9_.]+);`));
  if (!match) throw new Error(`user-facts: Rust const ${name} not found`);
  return Number(match[1].replaceAll("_", ""));
}

/** The dashboard cards in `CARD_REGISTRY`, in picker order. */
export function cardDefs(src) {
  const start = src.indexOf("static CARD_REGISTRY");
  if (start === -1) throw new Error("user-facts: static CARD_REGISTRY not found");
  const body = src.slice(start, src.indexOf("\n];", start));
  const entry = /((?:for_phd\(&)?)(?:stat|card)\(\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/g;
  const cards = [...body.matchAll(entry)].map(([, phd, id, name, group]) => ({
    id,
    name,
    group,
    supervisor: phd !== "",
  }));
  if (cards.length === 0) throw new Error("user-facts: no cards found in CARD_REGISTRY");
  return cards;
}

/** The labels of one theme option list (`LIGHT_THEME_OPTIONS` or `DARK_THEME_OPTIONS`). */
export function themeLabels(src, list) {
  const start = src.indexOf(`export const ${list}`);
  if (start === -1) throw new Error(`user-facts: ${list} not found`);
  const body = src.slice(start, src.indexOf("];", start));
  return [...body.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
}

const pct = (scale) => `${Math.round(scale * 100)}%`;

/** reader.md: zoom and pen limits. */
export function readerLimits() {
  const viewport = read("crates/wf-core/src/reader/viewport.rs");
  const undo = read("crates/wf-core/src/reader/ink_undo.rs");
  const stroke = read("crates/wf-core/src/reader/ink_stroke.rs");
  return [
    "| Setting | Value |",
    "| --- | --- |",
    `| Zoom, default | ${pct(rustConst(viewport, "READER_DEFAULT_SCALE"))} |`,
    `| Zoom, range | ${pct(rustConst(viewport, "READER_MIN_SCALE"))} to ${pct(rustConst(viewport, "READER_MAX_SCALE"))} |`,
    `| Zoom step | ${rustConst(viewport, "READER_ZOOM_STEP")} times per step |`,
    `| Undo depth for pen strokes | ${rustConst(undo, "INK_UNDO_LIMIT")} steps |`,
    `| Stroke points kept per stroke | ${rustConst(stroke, "INK_MAX_POINTS")} |`,
  ];
}

/**
 * What each card shows, in words. Kept here, next to the parser, so a new card
 * in the registry fails the docs build until somebody writes its line.
 */
const CARD_SHOWS = {
  "reading-progress": "Papers read against the total",
  "report-progress": "Report sections done against the total",
  "plan-progress": "Milestones done against the total",
  "experiments-summary": "Experiments done and running",
  "needs-attention": "Unread papers, milestones due soon or overdue, running experiments",
  "recent-log": "The latest log entries",
  "library-snapshot": "Paper, relation and list counts",
  "top-tags": "The most used tags",
  "team-roster": "Supervisees and their milestone status",
  "team-attention": "Supervisee milestones that are blocked or overdue",
  "supervisee-snapshot": "One supervisee's summary",
};

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** dashboard.md: the card catalogue. */
export function dashboardCards() {
  const cards = cardDefs(read("crates/wf-core/src/dashboard/card_registry.rs"));
  const missing = cards.filter((card) => !CARD_SHOWS[card.id]).map((card) => card.id);
  if (missing.length > 0) {
    throw new Error(`user-facts: write what these dashboard cards show in scripts/lib/user-facts.mjs: ${missing.join(", ")}`);
  }
  return [
    `The dashboard has ${WORDS[cards.length] ?? cards.length} card types:`,
    "",
    "| Card | Group | What it shows |",
    "| --- | --- | --- |",
    ...cards.map(
      (card) =>
        `| **${card.name}** (\`${card.id}\`) | ${card.group} | ${CARD_SHOWS[card.id]}${card.supervisor ? " (PhD and professor roles only)" : ""} |`,
    ),
  ];
}

/** settings.md: the themes the Appearance tab offers. */
export function themeList() {
  const src = read("apps/web/src/lib/theme/theme.ts");
  const light = themeLabels(src, "LIGHT_THEME_OPTIONS");
  const dark = themeLabels(src, "DARK_THEME_OPTIONS");
  return [
    `- Light (${light.length}): ${light.join(", ")}`,
    `- Dark (${dark.length}): ${dark.join(", ")}`,
  ];
}
