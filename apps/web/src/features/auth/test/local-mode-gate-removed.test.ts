import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 0.9.8 has no local database. The no-account flag stays: it now means files
 * mode (backend/providers/files). This guards both halves:
 * (a) no source file imports the local database provider, PGlite or local-pg,
 *     or uses LocalRunner or the old badge, and nothing ships test helpers;
 * (b) the flag is read only through backend/providers/files/no-account-mode.
 */

const REPO = fileURLToPath(new URL("../../../../../../", import.meta.url));
const WEB = join("apps", "web", "src");
const ROOTS = [WEB, join("apps", "shell", "bridge"), join("packages", "core", "src")];
const FLAG_MODULE = join(WEB, "backend", "providers", "files", "no-account-mode.ts");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sources = ROOTS.flatMap((root) => walk(join(REPO, root)))
  .filter((f) => /\.(ts|tsx|mts|js|jsx|mjs|css)$/.test(f))
  .filter((f) => !/\.test\.[cm]?[jt]sx?$/.test(f))
  .map((f) => relative(REPO, f));

// Test-only helpers that run SQL on an in-memory PGlite. Named one by one, so a
// new file under a test folder is still checked.
const TEST_DB_HELPERS = new Set([
  join(WEB, "backend", "test", "contracts", "harness.ts"),
  join(WEB, "backend", "test", "pg-test-db.ts"),
  join(WEB, "backend", "test", "pglite-client.ts"),
  join(WEB, "features", "org", "infrastructure", "test", "schema-hardening.rls.integration.ts"),
]);
const inTestFolder = (rel: string) => /[\\/]test[\\/]/.test(rel);

/** The code only: whole-line comments (`//`, `/*`, ` * `) are dropped so prose cannot trip a guard. */
function code(text: string): string {
  return text.split("\n").filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join("\n");
}

function offenders(pattern: RegExp, except: (rel: string) => boolean = () => false): string[] {
  return sources
    .filter((rel) => !except(rel))
    .filter((rel) => pattern.test(code(readFileSync(join(REPO, rel), "utf8"))));
}

/** A module specifier: after `from`, a side-effect `import`, or `import(` / `require(`. */
const SPEC = /(?:\bfrom\s+|\bimport\s+|\bimport\(\s*|\brequire\(\s*)["'`]/.source;

const LOCAL_DB = new RegExp([
  /["'`][^"'`\n]*(?:providers\/local(?:\/|["'`])|pglite|local-pg|local_pg)/.source,
  // The local provider from next door: ./local, ../local, ../local.ts, ../local/x.
  /["'`](?:\.{1,2}\/)+local(?:\.[cm]?[jt]sx?)?["'`/]/.source,
  // A bare "local" specifier (a path alias or package named local).
  `${SPEC}local["'\`/]`,
  /\bLocalRunner\b|LocalModeBadge|local-mode-badge/.source,
].join("|"), "i");

const TEST_IMPORT = new RegExp(`${SPEC}[^"'\`\\n]*\\/test\\/`);

test("no source file imports the local database or uses LocalRunner or the badge", () => {
  assert.deepEqual(offenders(LOCAL_DB, (rel) => TEST_DB_HELPERS.has(rel)), []);
});

test("the guard's pattern catches index, relative, bare and template imports", () => {
  for (const line of [
    `import x from "@/backend/providers/local";`,
    `import x from "@/backend/providers/local/runner";`,
    `import x from "../local";`,
    `import x from "./local";`,
    `import x from "../local.ts";`,
    `import x from "../../local/runner";`,
    `import x from "local";`,
    `import "local/side-effect";`,
    "await import(`@/backend/providers/local/pglite-client`);",
    `import { PGlite } from "@electric-sql/pglite";`,
  ]) assert.match(line, LOCAL_DB, line);
  for (const line of [
    `import x from "./local-storage";`,
    `import x from "../localize";`,
    `import x from "@/backend/providers/files";`,
    `const area: StorageArea = "local";`,
    `providers: ["local"],`,
  ]) assert.doesNotMatch(line, LOCAL_DB, line);
});

test("no shipped file imports a test helper", () => {
  assert.deepEqual(offenders(TEST_IMPORT, inTestFolder), []);
});

test("the test-helper pattern catches named, side-effect and dynamic imports, not comments", () => {
  for (const line of [
    `import { x } from "@/backend/test/pg-test-db";`,
    `import "../test/setup";`,
    "const m = await import(`./test/helper`);",
  ]) assert.match(line, TEST_IMPORT, line);
  for (const line of [`import x from "./latest/thing";`, `const url = "/api/test/";`]) {
    assert.doesNotMatch(line, TEST_IMPORT, line);
  }
  const commented = ["// see import x from \"../test/fixture\"", " * import \"../test/setup\"", "/* from \"./test/a\" */"].join("\n");
  assert.doesNotMatch(code(commented), TEST_IMPORT);
});

test("PGlite is a dev dependency only", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "apps", "web", "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies?.["@electric-sql/pglite"], undefined);
});

test("the no-account flag is read only through the files provider", () => {
  assert.equal(existsSync(join(REPO, WEB, "features", "auth", "infrastructure", "no-account-mode.ts")), false);
  assert.deepEqual(offenders(/features\/auth\/infrastructure\/no-account-mode/), []);
  const READS_FLAG = /\blocalModeKey\(|\blocalIsLocalMode\(|["']weaveforge\.local-mode["']/;
  assert.deepEqual(offenders(READS_FLAG, (rel) => rel === FLAG_MODULE), []);
  assert.match(readFileSync(join(REPO, FLAG_MODULE), "utf8"), /export function isLocalMode\(\): boolean/);
});
