import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * A class a component renders must have a rule somewhere.
 *
 * This exists because of a specific wrong conclusion, twice reached: that the
 * `.proj-menu` rules are dead code. They are not — `OrgSwitcher` renders
 * `.proj-menu`, `.proj-menu-item` and `.proj-menu-sep` exactly as
 * `ProjectSwitcher` used to, and the rules were shared between them precisely so
 * the two switchers would look alike. Deleting them because the *project*
 * switcher moved to a `Popover` would have left the lab switcher's drop-down
 * unstyled in the one configuration it appears in (more than one lab), which is
 * a configuration a single-account machine never sees and a probe therefore
 * cannot catch.
 *
 * The check is one-directional on purpose: a rule with no class in the code is
 * not necessarily dead — it can be applied by another rule's `:is()` list, or be
 * a state class — but a *class that is rendered* with no rule at all is always a
 * bug, and the two switchers are how it happened.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, "..");
const stylesDir = path.join(webSrc, "app", "styles");

function stylesheet(): string {
  return readdirSync(stylesDir)
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(path.join(stylesDir, name), "utf8"))
    .join("\n");
}

/** The class names a file mentions in a `className` position. */
function renderedClasses(source: string): string[] {
  const found = new Set<string>();
  // `className="a b"`, `` className={`a ${x} b`} ``, and `.push("a b")` shapes.
  for (const match of source.matchAll(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const chunk of [match[1], match[2]]) {
      if (!chunk) continue;
      for (const name of chunk.split(/[\s${}]+/)) {
        if (/^[a-z][a-z0-9-]*$/i.test(name)) found.add(name);
      }
    }
  }
  return [...found];
}

test("every class the switchers render has a rule", () => {
  const css = stylesheet();
  const switchers = [
    path.join(webSrc, "features", "org", "ui", "org-switcher.tsx"),
    path.join(webSrc, "features", "projects", "ui", "project-switcher.tsx"),
  ];
  const missing: string[] = [];
  for (const file of switchers) {
    for (const name of renderedClasses(readFileSync(file, "utf8"))) {
      // Only the switcher's own vocabulary: a shared utility class is declared
      // once for the whole app and is not this test's business.
      if (!name.startsWith("proj-") && !name.startsWith("org-")) continue;
      if (!css.includes(`.${name}`)) missing.push(`${path.basename(file)} renders .${name}`);
    }
  }
  assert.deepEqual(missing, [], `these classes are rendered and have no rule:\n${missing.join("\n")}`);
});

test("the shared drop-down the two switchers use is still declared", () => {
  const css = stylesheet();
  // The three the lab switcher depends on, named so a future cleanup that
  // greps for the project switcher's usage has to argue with this line.
  for (const name of ["proj-menu", "proj-menu-item", "proj-menu-sep"]) {
    assert.ok(css.includes(`.${name}`), `.${name} is rendered by OrgSwitcher and has no rule`);
  }
});
