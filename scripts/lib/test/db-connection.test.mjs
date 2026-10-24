import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadDatabaseUrl, walkFiles } from "../db-connection.mjs";

function repoWith(envText) {
  const root = mkdtempSync(join(tmpdir(), "wf-db-"));
  if (envText !== undefined) {
    mkdirSync(join(root, "secrets"));
    writeFileSync(join(root, "secrets", ".env.migration"), envText);
  }
  return root;
}

test("loadDatabaseUrl prefers DATABASE_URL from the environment", () => {
  const root = repoWith("DATABASE_URL=postgres://file\n");
  assert.equal(loadDatabaseUrl(root, { DATABASE_URL: "postgres://env" }), "postgres://env");
});

test("loadDatabaseUrl reads secrets/.env.migration and strips quotes and spaces", () => {
  assert.equal(loadDatabaseUrl(repoWith("A=1\nDATABASE_URL=postgres://u@h/db  \n"), {}), "postgres://u@h/db");
  assert.equal(loadDatabaseUrl(repoWith('DATABASE_URL="postgres://q"\r\n'), {}), "postgres://q");
  assert.equal(loadDatabaseUrl(repoWith("DATABASE_URL='postgres://s'"), {}), "postgres://s");
});

test("an empty DATABASE_URL in the environment falls through to the file", () => {
  assert.equal(loadDatabaseUrl(repoWith("DATABASE_URL=postgres://file"), { DATABASE_URL: "" }), "postgres://file");
});

test("loadDatabaseUrl says where it looked when the key is missing", () => {
  assert.throws(() => loadDatabaseUrl(repoWith("OTHER=1\n# DATABASE_URL=x\n"), {}), /DATABASE_URL not found in .*\.env\.migration/);
});

test("loadDatabaseUrl fails loudly when the file is missing", () => {
  assert.throws(() => loadDatabaseUrl(repoWith(), {}), { code: "ENOENT" });
});

test("walkFiles returns matching files at every depth", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-walk-"));
  mkdirSync(join(root, "a", "b"), { recursive: true });
  for (const f of ["route.ts", "a/route.ts", "a/b/route.ts", "a/b/page.tsx", "a/other.ts"]) writeFileSync(join(root, f), "");
  mkdirSync(join(root, "route.ts.d"));
  const found = walkFiles(root, (name) => name === "route.ts").map((p) => p.slice(root.length + 1).replaceAll("\\", "/"));
  assert.deepEqual(found.sort(), ["a/b/route.ts", "a/route.ts", "route.ts"]);
  assert.deepEqual(walkFiles(join(root, "a", "b"), () => false), []);
});
