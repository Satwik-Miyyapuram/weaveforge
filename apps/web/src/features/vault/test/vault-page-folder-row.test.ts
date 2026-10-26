/** A folder flag survives the row round trip and has a nullable column (E45). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { testDb } from "../../../backend/test/pg-test-db";
import { toDomain, toRow, toSummaryDomain, type VaultPageRow } from "../infrastructure/vault-page-rows";

const repo = fileURLToPath(new URL("../../../../../../", import.meta.url));
const row: VaultPageRow = {
  id: "p1",
  title: "Folder",
  parent_id: null,
  sort_order: 0,
  created_at: "2026-10-26T00:00:00Z",
  updated_at: "2026-10-26T00:00:00Z",
};

test("is_folder maps both ways; NULL or absent reads as a note", () => {
  assert.equal(toDomain({ ...row, is_folder: true }).isFolder, true);
  assert.equal(toSummaryDomain({ ...row, is_folder: true }).isFolder, true);
  assert.equal(toDomain({ ...row, is_folder: null }).isFolder, false);
  assert.equal(toDomain(row).isFolder, false);
  assert.equal(toRow({ ...toDomain(row), body: "", isFolder: true }).is_folder, true);
  assert.equal(toRow({ ...toDomain(row), body: "" }).is_folder, false);
});

test("both column lists read is_folder", () => {
  const src = readFileSync(join(repo, "apps/web/src/features/vault/infrastructure/postgrest-vault-page-repository.ts"), "utf8");
  assert.match(src, /VAULT_PAGE_COLUMNS = "[^"]*\bis_folder\b/);
  assert.match(src, /VAULT_SUMMARY_COLUMNS =\s*"[^"]*\bis_folder\b/);
});

test("the migration adds a nullable is_folder and writes no rows", () => {
  const sql = readFileSync(join(repo, "db/migrations/0152_vault_pages_is_folder.sql"), "utf8");
  assert.match(sql, /add column if not exists is_folder boolean default false;/);
  assert.doesNotMatch(sql, /not null/i);
  assert.doesNotMatch(sql, /\bupdate\b/i);
});

test("the wiki root is a folder, and an old root is marked before pages go in it", () => {
  const src = readFileSync(join(repo, "apps/web/src/features/wiki/application/build-wiki.ts"), "utf8");
  assert.match(src, /add\(\{ title: WIKI_ROOT_TITLE, isFolder: true \}\)/);
  assert.match(src, /!root\.isFolder\) \{[\s\S]*?update\(root\.id, \{ isFolder: true \}\)/);
});

test("the explorer's folder draft makes a folder", () => {
  const src = readFileSync(join(repo, "apps/web/src/features/editor-workspace/ui/workspace-screen.tsx"), "utf8");
  assert.match(src, /isFolder: target\.kind === "folder"/);
  assert.match(src, /input\.isFolder \? \{ isFolder: true \}/);
  const panel = readFileSync(join(repo, "apps/web/src/features/editor-workspace/ui/explorer-panel.tsx"), "utf8");
  assert.match(panel, /!isDocumentKind\(node\.kind\) \|\| node\.isFolder \? \(\s*<FolderIcon \/>/);
});

test("0152 on the migrated chain: nullable, default false; rollback and rerun are safe", async () => {
  const db = await testDb();
  const column = () =>
    db.sql<{ is_nullable: string; column_default: string | null }>(
      "select is_nullable, column_default from information_schema.columns where table_name = 'vault_pages' and column_name = 'is_folder'",
    );
  assert.deepEqual(await column(), [{ is_nullable: "YES", column_default: "false" }]);
  const sql = (rel: string) => readFileSync(join(repo, rel), "utf8");
  await db.exec(sql("db/migrations/0152_vault_pages_is_folder.sql"));
  await db.exec(sql("db/migrations-rollback/0152_vault_pages_is_folder.sql"));
  await db.exec(sql("db/migrations-rollback/0152_vault_pages_is_folder.sql"));
  assert.deepEqual(await column(), []);
  await db.exec(sql("db/migrations/0152_vault_pages_is_folder.sql"));
  assert.equal((await column()).length, 1);
});
