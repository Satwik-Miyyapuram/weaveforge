/**
 * No npm package may ship to the browser twice.
 *
 * When a dependency asks for a version range ours does not satisfy, npm nests a
 * second copy under it and webpack bundles both. The first one found was KaTeX:
 * ours (0.18) for maths in notes, and mermaid's own (0.16) for maths inside a
 * diagram — 75 KB gzipped each. `bundle:budget` could not see it, because both
 * copies load on demand and the budget measures what a route loads before it
 * paints. This reads the package list the build writes
 * (`apps/web/scripts/lib/client-packages-plugin.mjs`) and fails on any package
 * that came from more than one directory.
 *
 * Runs after `npm run build`, like `bundle:budget`.
 *
 *     npm run bundle:duplicates
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const listFile = path.join(root, "apps/web/.next/client-packages.json");

/**
 * Duplicates that cannot be merged, each with the reason — a ratchet.
 *
 * An entry belongs here only when the copies need different major versions, so
 * one cannot stand in for the other. An entry that stops being duplicated fails
 * the check too, so the list only shrinks.
 */
// Empty since diagrams moved from mermaid to pele (no dependencies): every
// entry here was one of mermaid's — its layout plugins' cose-base and
// layout-base, d3-sankey's d3 1.x/2.x line, and its own KaTeX 0.16.
const ALLOWED = {};

let packages;
try {
  packages = JSON.parse(readFileSync(listFile, "utf8"));
} catch {
  console.error(
    "FAIL: no package list to read. Run `npm run build` first — this check reads\n" +
      "      apps/web/.next/client-packages.json, which the production build writes.",
  );
  process.exit(1);
}

const copiesByName = new Map();
for (const [dir, { name, version, chunks }] of Object.entries(packages)) {
  if (!copiesByName.has(name)) copiesByName.set(name, []);
  copiesByName.get(name).push({ dir, version, chunks });
}

if (copiesByName.size === 0) {
  console.error("FAIL: the package list is empty — this check read nothing.");
  process.exit(1);
}

const duplicated = [...copiesByName].filter(([, copies]) => copies.length > 1);
const unexpected = duplicated.filter(([name]) => !(name in ALLOWED));
const stale = Object.keys(ALLOWED).filter((name) => !duplicated.some(([dup]) => dup === name));

if (unexpected.length) {
  console.error("FAIL: a package ships to the browser more than once:");
  for (const [name, copies] of unexpected) {
    console.error(`  ${name}`);
    for (const { dir, version, chunks } of copies) {
      console.error(`    ${version.padEnd(10)} ${dir}  (${chunks.length} chunk${chunks.length === 1 ? "" : "s"})`);
    }
  }
  console.error(
    "\n  What to do: `npm ls <name>` shows who asks for which range. If one version\n" +
      "  satisfies every caller, dedupe (`npm dedupe`) or add an npm override in the\n" +
      "  root package.json. Allow it in this script only when the copies need\n" +
      "  different major versions, with a note saying which callers need which.",
  );
}

if (stale.length) {
  console.error(
    `FAIL: allowed as duplicated but now shipped once: ${stale.join(", ")}.\n` +
      "      Remove the entry from ALLOWED in scripts/check-bundle-duplicates.mjs.",
  );
}

if (unexpected.length || stale.length) process.exit(1);

console.log(
  `No unexpected duplicate packages (${copiesByName.size} packages in the browser build; ${duplicated.length} allowed duplicates).`,
);
