/**
 * Sync layer 3: a `docs/using` page says which code it describes and when a
 * person last checked it against that code.
 *
 *   ---
 *   covers:
 *     - apps/web/src/features/reader
 *     - crates/wf-core/src/reader
 *   checked: 2026-11-14
 *   ---
 *
 * When covered code changes after `checked`, CI prints a warning on the page.
 * It never fails the build: the code may have changed in a way the page does
 * not mention, and only a reader can tell.
 */

const BLOCK = /^---\n([\s\S]*?)\n---\n/;

/** `{ covers, checked }` from a page's front matter, or null when it has none. */
export function frontMatter(md) {
  const block = md.replace(/\r\n/g, "\n").match(BLOCK);
  if (!block) return null;
  const covers = [...block[1].matchAll(/^\s+-\s+(\S+)\s*$/gm)].map((match) => match[1]);
  const checked = block[1].match(/^checked:\s*(.+?)\s*$/m)?.[1] ?? "";
  return { covers, checked };
}

/**
 * What to warn about for one page. `io.exists(path)` says whether a covered
 * path is there; `io.lastChange(path)` is the YYYY-MM-DD of its last commit.
 */
export function pageWarnings(meta, io) {
  if (!meta) return ["no covers:/checked: front matter. Say which code this page describes."];
  const warnings = [];
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(meta.checked);
  if (!dated) warnings.push(`checked: must be a YYYY-MM-DD date, not ${meta.checked}.`);
  if (meta.covers.length === 0) warnings.push("covers: lists no paths.");
  let newest = null;
  for (const dir of meta.covers) {
    if (!io.exists(dir)) {
      warnings.push(`covers: ${dir} does not exist.`);
      continue;
    }
    const changed = io.lastChange(dir);
    if (dated && changed && changed > meta.checked && (!newest || changed > newest.changed)) newest = { dir, changed };
  }
  if (newest) {
    warnings.push(
      `${newest.dir} changed on ${newest.changed}, after this page was checked on ${meta.checked}. Reread the page, fix what moved, and set checked: to today.`,
    );
  }
  return warnings;
}
