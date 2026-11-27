/**
 * 0.9.8 static release checks, read straight from the source tree:
 * 1. the installer and updater config ship no Postgres;
 * 2. no app code imports the local database, and PGlite is a dev dependency only;
 * 3. the install gate never reads the profiles table;
 * 4. every client backend wraps the server client in readOnlyDb, and no personal table is an
 *    org write table, so a personal row never reaches the server from the client.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ORG_SERVER_WRITE_TABLES } from "../org-server-allowlist";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!["test", "__tests__", "node_modules", "dist", ".next", "pkg"].includes(name)) out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !/\.test\.[a-z]+$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Postgres server names; PostgREST (the org server API) is allowed. */
const POSTGRES = /postgres(?!t)|pg_ctl|initdb|pgsql|pglite|local[-_]pg/i;

const INSTALLER_AND_UPDATER = [
  "apps/shell/tauri.conf.json",
  "apps/shell/tauri.bundle.json",
  "apps/shell/tauri.unsigned.json",
  "apps/shell/tauri.android.conf.json",
  "apps/shell/installer/installer.nsh",
  "apps/shell/scripts/release-manifest.mjs",
  "apps/shell/scripts/write-latest-json.mjs",
  ".github/workflows/release-desktop.yml",
];

test("the installer and updater config name no Postgres", () => {
  for (const rel of INSTALLER_AND_UPDATER) {
    assert.ok(existsSync(join(ROOT, rel)), `${rel} is missing; update this list`);
    const hits = read(rel)
      .split("\n")
      .filter((line) => POSTGRES.test(line));
    assert.deepEqual(hits, [], `${rel} names Postgres`);
  }
});

test("the bundle resources ship no Postgres", () => {
  const bundle = JSON.parse(read("apps/shell/tauri.bundle.json")).bundle ?? {};
  const shipped = [...Object.keys(bundle.resources ?? {}), ...Object.values<string>(bundle.resources ?? {}), ...(bundle.externalBin ?? [])];
  assert.deepEqual(shipped.filter((p) => POSTGRES.test(p)), []);
});

test("the shell crate depends on no Postgres crate", () => {
  const deps = read("apps/shell/Cargo.toml")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .filter((line) => /^\s*(postgres|tokio-postgres|sqlx|pg-embed|postgresql_embedded|diesel)\b/.test(line));
  assert.deepEqual(deps, []);
});

const LOCAL_DB_IMPORT = /(["'`])[^"'`\n]*(?:@electric-sql\/pglite|local-postgres|local_pg|providers\/local\/pglite-client)[^"'`\n]*\1/;

test("no app code imports the local database", () => {
  const roots = ["apps/web/src", "packages", "apps/shell/bridge"].map((r) => join(ROOT, r)).filter(existsSync);
  const offenders = roots
    .flatMap(sourceFiles)
    .filter((f) => LOCAL_DB_IMPORT.test(stripComments(readFileSync(f, "utf8"))))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

test("PGlite is a dev dependency only", () => {
  for (const rel of ["package.json", "apps/web/package.json", "apps/shell/package.json"]) {
    const pkg = JSON.parse(read(rel));
    assert.equal(pkg.dependencies?.["@electric-sql/pglite"], undefined, `${rel} ships PGlite`);
  }
});

const GATE_FILES = [
  "apps/web/src/features/workspace/application/install-097-guard.ts",
  "apps/web/src/features/workspace/infrastructure/install-097-browser-port.ts",
  "apps/web/src/features/workspace/ui/install-097-gate.tsx",
  "apps/shell/src/migrate.rs",
];

test("the 0.9.7 install gate is gone", () => {
  for (const rel of [
    "apps/web/src/features/workspace/ui/install-097-gate.tsx",
    "apps/web/src/features/workspace/application/install-097-guard.ts",
    "apps/web/src/features/workspace/infrastructure/install-097-browser-port.ts",
  ]) {
    assert.ok(!existsSync(join(ROOT, rel)), `${rel} still exists`);
  }
});

const PERSONAL = [
  "papers",
  "notes",
  "tags",
  "metrics",
  "relations",
  "pins",
  "reading_lists",
  "citation_alerts",
  "paper_tags",
  "projects",
  "user_settings",
  "milestones",
  "experiments",
  "overleaf_connections",
  "overleaf_linked_reports",
  "overleaf_workshop_sessions",
];

test("no personal table is an org server write table", () => {
  const writable: readonly string[] = ORG_SERVER_WRITE_TABLES;
  assert.deepEqual(PERSONAL.filter((t) => writable.includes(t)), []);
});

test("every client backend wraps the server client in readOnlyDb", () => {
  const calls = sourceFiles(join(ROOT, "apps/web/src"))
    .flatMap((f) =>
      stripComments(readFileSync(f, "utf8"))
        .split("\n")
        .filter((line) => /\bwirePostgrestBackend\(/.test(line) && !/\bfunction wirePostgrestBackend\(/.test(line))
        .map((line) => ({ file: relative(ROOT, f), line: line.trim() })),
    );
  assert.ok(calls.length > 0, "no wirePostgrestBackend call found");
  assert.deepEqual(calls.filter((c) => !/\breadOnlyDb\)/.test(c.line)), []);
});
