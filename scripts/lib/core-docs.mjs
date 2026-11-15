/**
 * Core docs drift: each Rust core module needs a page, and each page must be
 * listed in the README. Pure: the CLI in scripts/check-core-docs.mjs supplies
 * the tracked paths and the page text.
 */

const CORE_SRC = "crates/wf-core/src/";

/** Pages in the README index that the README does not link as `](name.md)`. */
export function unlistedPages(pageNames, readmeText) {
  return pageNames.filter((name) => !readmeText.includes(`](${name})`));
}

/** Top-level modules under crates/wf-core/src: a dir or a `<m>.rs` file. */
export function coreModules(trackedPaths) {
  const modules = new Set();
  for (const rel of trackedPaths) {
    if (!rel.startsWith(CORE_SRC)) continue;
    const parts = rel.slice(CORE_SRC.length).split("/");
    if (parts.length === 1) {
      if (!parts[0].endsWith(".rs") || parts[0] === "lib.rs" || parts[0] === "mod.rs") continue;
      modules.add(parts[0].slice(0, -3));
    } else {
      modules.add(parts[0]);
    }
  }
  return [...modules].sort();
}

/**
 * Modules no page mentions. A mention is the path (ending at `/`, `.rs`, a
 * backtick or the end) or the name in backticks, as the page tables write it:
 * `name`, `name.rs`, `name/` or `name::item`.
 */
export function undocumentedModules(modules, pagesText, allow) {
  return modules.filter((name) => {
    if (allow.includes(name)) return false;
    const path = new RegExp(`${CORE_SRC}${name}(?=/|\\.rs|\`|$)`);
    const ticked = new RegExp(`\`${name}(?:\\.rs|/|::[^\`]*)?\``);
    return !path.test(pagesText) && !ticked.test(pagesText);
  });
}
