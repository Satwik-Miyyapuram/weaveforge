/**
 * Sync layer 2: the names a how-to tells you to click must exist in the app.
 *
 * A how-to step writes a button, tab or field name in bold. This module pulls
 * those names out of the numbered steps of a `docs/using` page and looks for
 * each one in the app's source text, so a renamed button fails `check:docs`
 * until the page follows. `N` and `<name>` in a doc stand for a value the app
 * fills in, and match a `${…}` or `{…}` expression in the source.
 */

const GENERATED = /<!-- generated:[\s\S]*?<!-- \/generated:[^>]*-->/g;
const LEAD_IN = /^\s*(?:\d+\.|-)\s+\*\*[^*]+\*\*/;

/** Bold names inside the numbered steps of a Markdown page. */
export function stepNames(md) {
  const steps = [];
  let inStep = false;
  for (const line of md.replace(GENERATED, "").split("\n")) {
    if (/^\d+\. /.test(line)) inStep = true;
    else if (/^\S/.test(line)) inStep = false;
    if (inStep) steps.push(line.replace(LEAD_IN, "").trim());
  }
  const names = [];
  for (const [, bold] of steps.join(" ").matchAll(/\*\*([^*]+)\*\*/g)) {
    if (bold.startsWith("`")) continue;
    names.push(...bold.split("→").map((part) => part.trim()));
  }
  return names;
}

/** The app's source files as one searchable string. */
export function appText(sources) {
  return sources
    .join("\n")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pattern(name) {
  const body = name
    .replace(/[‘’]/g, "'")
    .split(/(\bN\b|<[^>]+>)/)
    .map((part, i) => (i % 2 === 1 ? "\\$?\\{[^{}]{1,80}\\}" : escape(part)))
    .join("");
  return new RegExp(`(?<![\\w-])${body}(?![\\w-])`);
}

/** The names found nowhere in `app` and not in `allow`, in order. */
export function missingNames(names, app, allow) {
  return names.filter((name) => !allow.has(name) && !pattern(name).test(app));
}

/** The allow list: one name per line, `#` starts a comment. */
export function parseAllow(text) {
  return new Set(
    text
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim())
      .filter(Boolean),
  );
}
