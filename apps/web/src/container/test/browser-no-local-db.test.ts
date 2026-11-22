import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * 0.9.8: the browser and Android build open the files backend plus a server-only org. They carry no
 * local database: no Postgres or PGlite package, and no new path into the desktop local-DB provider.
 *
 * The walk follows every value import (static, re-export, dynamic) from the browser container; type-only
 * imports are erased at build time and skipped.
 */

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const ENTRY = fileURLToPath(new URL("../browser-file-backend.ts", import.meta.url));
const EXTS = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

/** Any package that would bundle a database engine or driver. */
const DB_PACKAGE = /(^|\/)(pglite|pg|postgres|pg-[\w-]+|@electric-sql\/[\w-]+|sql\.js|better-sqlite3|sqlite3|wa-sqlite)(\/|$)/i;

/** The desktop local-DB provider and the offline-sync engine. */
const LOCAL_DB_MODULE = /^(backend\/providers\/local\/|features\/offline-sync\/)/;

/**
 * Local-DB modules the browser graph still reaches today, each through a shared module, none selected at
 * runtime (local-mode-not-selected.test.ts). WEB lane: remove an entry when its path is cut; never add one.
 *  - local-identity, parts, parts-1, pglite-client: via lib/parts.ts (localBackendParts, isLocalMode).
 *  - offline-sync shared-rows: via wire-postgrest-backend.ts (withShareMarks).
 */
const KNOWN_REACHED = new Set([
  "backend/providers/local/local-identity.ts",
  "backend/providers/local/parts.ts",
  "backend/providers/local/parts-1.ts",
  "backend/providers/local/pglite-client.ts",
  "features/offline-sync/domain/shared-rows.ts",
]);

/** Value-import specifiers of one module: imports and re-exports that are not type-only, plus import(). */
export function valueSpecifiers(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) found.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith(".") ? resolve(dirname(from), spec) : spec.startsWith("@/") ? resolve(SRC, spec.slice(2)) : null;
  if (base === null) return null;
  for (const ext of EXTS) {
    const path = base + ext;
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  throw new Error(`unresolved import ${spec} in ${relative(SRC, from)}`);
}

/** Every module reached from the entry (paths relative to src/, forward slashes) and every bare package. */
function walk(entry: string): { modules: Set<string>; packages: Map<string, string> } {
  const seen = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueSpecifiers(file, readFileSync(file, "utf8"))) {
      const next = resolveLocal(file, spec);
      if (next === null) packages.set(spec, relative(SRC, file).replace(/\\/g, "/"));
      else if (!seen.has(next)) queue.push(next);
    }
  }
  return { modules: new Set([...seen].map((f) => relative(SRC, f).replace(/\\/g, "/"))), packages };
}

test("the browser container reaches no database package", () => {
  const { modules, packages } = walk(ENTRY);
  assert.ok(modules.size > 50, `the walk followed the graph (${modules.size} modules)`);
  for (const [pkg, from] of packages) assert.doesNotMatch(pkg, DB_PACKAGE, `${from} imports ${pkg}`);
});

test("the browser container reaches no new local-DB module (WEB lane shrinks KNOWN_REACHED)", () => {
  const { modules } = walk(ENTRY);
  const reached = [...modules].filter((m) => LOCAL_DB_MODULE.test(m)).sort();
  const added = reached.filter((m) => !KNOWN_REACHED.has(m));
  assert.deepEqual(added, [], `new local-DB modules in the browser graph: ${added.join(", ")}`);
  const cut = [...KNOWN_REACHED].filter((m) => !modules.has(m));
  assert.deepEqual(cut, [], `no longer reached, drop from KNOWN_REACHED: ${cut.join(", ")}`);
});

test("the walk skips type-only imports and catches dynamic and re-export imports", () => {
  const src = [
    'import type { A } from "./type-only";',
    'export type { B } from "./type-export";',
    'import { C } from "./value";',
    'export { D } from "./re-export";',
    'const m = await import("./dynamic");',
    "const n = await import(`./template`);",
  ].join("\n");
  assert.deepEqual(valueSpecifiers("x.ts", src).sort(), ["./dynamic", "./re-export", "./template", "./value"]);
});

test("the database-package check matches engines and drivers, not lookalikes", () => {
  for (const pkg of ["@electric-sql/pglite", "pg", "postgres", "pg-protocol", "sql.js", "better-sqlite3"]) assert.match(pkg, DB_PACKAGE);
  for (const pkg of ["pdfjs-dist", "@supabase/supabase-js", "isomorphic-git", "pgp-utils", "postgresql-docs-x"]) {
    assert.doesNotMatch(pkg, DB_PACKAGE);
  }
});
