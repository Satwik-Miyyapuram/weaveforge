/**
 * B red test (0.9.8) and ratchet: no non-test source file under apps/web/src or
 * packages/ imports the removed local database (PGlite, LocalRunner, the
 * local_pg / local-postgres modules, or the providers/local database modules).
 *
 * Allowlist: test folders (`test`, `__tests__`) and test files are not scanned,
 * so the PGlite contract and backend harnesses may stay there. Comments are
 * stripped before matching, so a mention in a comment is not an import.
 *
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const SCAN_ROOTS = [join(ROOT, "apps", "web", "src"), join(ROOT, "packages")];
const SKIP_DIRS = new Set(["test", "__tests__", "node_modules", "dist", ".next"]);
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

const SPECIFIER =
  /(["'`])[^"'`\n]*(?:pglite|local-postgres|local_pg|providers\/local\/(?:parts|parts-1|local-first|local-identity|pglite-client))[^"'`\n]*\1/i;
const SYMBOL = /\b(?:LocalRunner|localRunnerQuery|PGlite)\b/;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function importsLocalDb(src: string): boolean {
  const code = stripComments(src);
  return SPECIFIER.test(code) || SYMBOL.test(code);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...sourceFiles(full));
    } else if (SOURCE_FILE.test(name) && !/\.test\.[a-z]+$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const FORMS: Array<[string, string]> = [
  ["named type import from providers/local/parts", `import type { LocalRunner } from "@/backend/providers/local/parts";`],
  ["re-export of LocalRunner", `export { LocalRunner } from "./parts";`],
  ["export star from @electric-sql/pglite", `export * from "@electric-sql/pglite";`],
  ["double-quoted dynamic import of pglite-client", `const m = await import("@/backend/providers/local/pglite-client");`],
  ["backtick dynamic import of pglite-client", "const m = await import(`@/backend/providers/local/pglite-client`);"],
  ["side-effect import of pglite", `import "@electric-sql/pglite";`],
  ["named import of PGlite", `import { PGlite } from "@electric-sql/pglite";`],
  ["aliased LocalRunner import", `import { LocalRunner as Runner } from "./parts";`],
  ["namespace import then member LocalRunner", `import * as l from "./parts";\nconst R = l.LocalRunner;`],
  ["default import of pglite", `import PG from "@electric-sql/pglite";`],
  ["require of pglite-client", `const m = require("./pglite-client");`],
  ["import of local-postgres from packages/core", `import { openLocal } from "@weaveforge/core/database/local-postgres";`],
  ["import of local_pg path", `import x from "../../shell/src/local_pg/index";`],
];

for (const [label, source] of FORMS) {
  test(`ratchet detects ${label}`, () => {
    assert.equal(importsLocalDb(source), true);
  });
}

test("ratchet ignores unrelated imports", () => {
  assert.equal(importsLocalDb(`import { Foo } from "@/lib/foo";`), false);
});

test("ratchet ignores a mention inside a comment", () => {
  assert.equal(importsLocalDb(`// was: import { LocalRunner } from "./parts";\n/* PGlite removed */\nexport const x = 1;`), false);
});

test("the core runtime barrel does not export applyMigrations (the local migrator)", () => {
  const barrel = readFileSync(join(ROOT, "packages", "core", "src", "index.ts"), "utf8");
  assert.doesNotMatch(barrel, /database\/migrations/);
});

test("no non-test source under apps/web/src or packages/ imports the removed local database", () => {
  const offenders = SCAN_ROOTS.flatMap(sourceFiles)
    .filter((file) => importsLocalDb(readFileSync(file, "utf8")))
    .map((file) => relative(ROOT, file).split(sep).join("/"));
  assert.deepEqual(offenders, [], `still importing the removed local database: ${offenders.join(", ")}`);
});
