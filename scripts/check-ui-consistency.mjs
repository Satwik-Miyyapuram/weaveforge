#!/usr/bin/env node
/**
 * UI consistency gate for CI / pre-PR. Exits 1 when violations are found.
 *
 * The app has a small set of shared components that own the look and the
 * keyboard/ARIA behaviour of a control. A raw HTML element used in their place
 * still *works*, so nothing fails and nobody notices — until a dropdown renders
 * as a native OS widget in the middle of a themed dialog. That is exactly how
 * the Overleaf export's bibliography select drifted.
 *
 * Every rule below is a banned raw pattern plus the component to use instead.
 * Adding a shared component means adding a row to RULES — not editing logic.
 *
 * A rule must be clean when it is added. A gate that ships red teaches people
 * to ignore it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where app UI lives. Shared components themselves are exempt per-rule. */
const UI_PATHS = [
  "apps/web/src/features",
  "apps/web/src/app",
  "apps/web/src/components",
];

/**
 * @typedef {object} Rule
 * @property {string} name     Short label in the failure output.
 * @property {RegExp} pattern  Banned usage. Must be global; may span lines.
 * @property {string} use      What to use instead.
 * @property {string} [why]    Why it matters, when not obvious.
 * @property {string} [unless] A match containing this substring is fine.
 * @property {string[]} [allow] Path fragments exempt from the rule.
 */

/** @type {Rule[]} */
const RULES = [
  {
    name: "raw <select>",
    pattern: /<select[\s>]/g,
    use: "<Select> from @/components/select",
    why: "the native control ignores the app's theme and menu behaviour",
    allow: ["components/select.tsx"],
  },
  {
    name: "raw <dialog>",
    pattern: /<dialog[\s>]/g,
    use: "<Modal> from @/components/modal",
    why: "Modal owns focus trapping, the close affordance and the overlay",
  },
  {
    name: "unthemed checkbox",
    pattern: /<input\b[^>]*?type="checkbox"[^>]*?>/gs,
    unless: "themed-check",
    use: 'className="themed-check" on the input',
    why: "the bare browser checkbox does not follow the active theme",
  },
  {
    name: "OS confirmation dialog",
    pattern: /window\.(confirm|prompt|alert)\(/g,
    use: "<ConfirmDialog> from @/components/confirm-dialog, or <PromptDialog> from @/components/prompt-dialog when it takes text",
    why: "a system dialog ignores the theme and, on a phone, covers the page it is asking about",
    // The two error boundaries are the deliberate exception: they may be
    // rendering because the component tree that draws the app's own modal is
    // what failed, so their confirmation must depend on nothing that could be
    // the thing that broke. Both carry a comment saying so.
    allow: ["app/route-error.tsx", "app/global-error.tsx"],
  },
  {
    name: "onClick on a list item",
    pattern: /<li\b[^>]*?\bonClick=/gs,
    use: "a <button> inside the <li>",
    why: "a clickable <li> has no role, no tab stop and no Enter/Space handling, so it cannot be operated by keyboard",
  },
  {
    name: "bare empty state",
    pattern: /className="empty"/g,
    use: '<EmptyState variant="first-run" | "no-results"> from @/components/empty-state',
    why: "one grey sentence with nothing to click, on the screen where a new user decides whether the product is for them",
  },
];

/**
 * Every `.ts` and `.tsx` file under the UI paths.
 *
 * `.ts` as well, not only the files that can hold JSX. Most of the rules below
 * are about markup and can only match a `.tsx`, but one of them is not: an OS
 * dialog lives wherever the code that asks the question lives, and in the reader
 * that was a hook — `features/reader/ui/pdf-reader/use-annotation-actions.ts`.
 * Scanning `.tsx` alone meant the one gate written for that rule could not see
 * the one call site that broke it, so an unstyled `window.confirm` shipped back
 * into the product *after* the design audit that found the last three had been
 * closed. A gate that cannot see the file the violation is in is not a gate.
 */
function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = UI_PATHS.flatMap((p) => collect(path.join(root, p)));
let failed = false;

for (const rule of RULES) {
  const hits = [];
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    if ((rule.allow ?? []).some((frag) => rel.includes(frag))) continue;

    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.unless && match[0].includes(rule.unless)) continue;
      const line = text.slice(0, match.index).split("\n").length;
      hits.push(`${rel}:${line}`);
    }
  }

  if (hits.length > 0) {
    failed = true;
    console.error(`FAIL: ${rule.name} — use ${rule.use}${rule.why ? ` (${rule.why})` : ""}:`);
    for (const hit of hits) console.error(`  ${hit}`);
  }
}

if (failed) {
  console.error(
    "\nThese controls must match the rest of the app. If a shared component genuinely\n" +
      "cannot express what you need, extend the component rather than dropping to raw\n" +
      "HTML — then this gate keeps holding for everyone else.",
  );
  process.exit(1);
}

console.log("UI consistency checks passed.");
