/**
 * B red test (0.9.8): no non-test source file imports the PGlite client or
 * LocalRunner. The PGlite migration tests of server migrations are excluded
 * (they are tests, and tests are not scanned).
 *
 * Expected red until B lands: the consumers listed in the failure message still
 * import them. Each is deleted or repointed by B, then this turns green.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const FORBIDDEN =
  /["'][^"']*(?:pglite-client|@electric-sql\/pglite)[^"']*["']|\{[^}]*\bLocalRunner\b[^}]*\}\s*from\b/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "test" || name === "__tests__") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const FORMS = [
  `import type { LocalRunner } from "@/backend/providers/local/parts";`,
  `export { LocalRunner } from "./parts";`,
  `export * from "@electric-sql/pglite";`,
  `const m = await import("@/backend/providers/local/pglite-client");`,
  `import "@electric-sql/pglite";`,
  `import { PGlite } from "@electric-sql/pglite";`,
  `import { openClient } from "./pglite-client";`,
  `import { LocalRunner as Runner } from "./parts";`,
];

for (const form of FORMS) {
  test(`forbidden pattern detects: ${form}`, () => {
    assert.equal(FORBIDDEN.test(form), true);
  });
}

test("forbidden pattern ignores unrelated imports", () => {
  assert.equal(FORBIDDEN.test(`import { Foo } from "@/lib/foo";`), false);
});

test("no non-test src file imports pglite-client or LocalRunner [expected-red until B]", () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => FORBIDDEN.test(readFileSync(file, "utf8")))
    .map((file) => relative(SRC, file).split(sep).join("/"));
  assert.deepEqual(offenders, [], `still importing PGlite or LocalRunner: ${offenders.join(", ")}`);
});
