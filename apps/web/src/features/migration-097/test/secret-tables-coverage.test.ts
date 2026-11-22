import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SECRET_SCOPE } from "../application/move-secrets";
import { EXCLUDED_SECRET_TABLES, SECRET_TABLES } from "../domain/secret-tables";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../db/migrations");

/** Column names that hold a secret: an integration token, an API key, or a sealed (ciphertext) value. */
const SECRET_COLUMN = /^token$|_ciphertext$|api_key$/;
const CONSTRAINT_WORDS = new Set(["constraint", "primary", "unique", "foreign", "check", "exclude", "like"]);

/**
 * The columns each table holds after every migration, read in file order. CREATE TABLE and ADD COLUMN
 * add, DROP COLUMN removes, DROP TABLE forgets the table. Static scan only: no SQL is run.
 */
function liveColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--.*$/gm, "");
    for (const stmt of sql.split(";")) {
      const created = /create table\s+(?:if not exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*)\)/i.exec(stmt);
      if (created) {
        const cols = new Set<string>();
        for (const line of created[2].split("\n")) {
          const col = /^\s*"?(\w+)"?\s+\w/.exec(line);
          if (col && !CONSTRAINT_WORDS.has(col[1].toLowerCase())) cols.add(col[1]);
        }
        tables.set(created[1], cols);
        continue;
      }
      const dropped = /drop table\s+(?:if exists\s+)?(?:public\.)?"?(\w+)"?/i.exec(stmt);
      if (dropped) {
        tables.delete(dropped[1]);
        continue;
      }
      const altered = /alter table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?([\s\S]*)/i.exec(stmt);
      if (!altered) continue;
      const cols = tables.get(altered[1]) ?? new Set<string>();
      tables.set(altered[1], cols);
      for (const clause of altered[2].matchAll(/(add|drop) column\s+(?:if (?:not )?exists\s+)?"?(\w+)"?/gi)) {
        if (clause[1].toLowerCase() === "add") cols.add(clause[2]);
        else cols.delete(clause[2]);
      }
    }
  }
  return tables;
}

test("every table with a secret-like column is in SECRET_TABLES or EXCLUDED_SECRET_TABLES", () => {
  const secretTables = [...liveColumns()]
    .filter(([, cols]) => [...cols].some((c) => SECRET_COLUMN.test(c)))
    .map(([table]) => table)
    .sort();
  const covered = new Set([...SECRET_TABLES, ...EXCLUDED_SECRET_TABLES].map((t) => t.table));

  assert.deepEqual(
    secretTables.filter((t) => !covered.has(t)),
    [],
    "a table with a secret column is in neither list: count it, or exclude it with a reason",
  );
  for (const known of ["project_integrations", "user_settings", "overleaf_connections", "overleaf_workshop_sessions"]) {
    assert.ok(secretTables.includes(known), `the scan finds ${known} (guards against an empty scan)`);
  }
});

test("every excluded table has a reason, and no table is both counted and excluded", () => {
  const counted = new Set(SECRET_TABLES.map((t) => t.table));
  for (const entry of EXCLUDED_SECRET_TABLES) {
    assert.ok(entry.reason.trim().length > 0, `${entry.table} needs a reason`);
    assert.ok(!counted.has(entry.table), `${entry.table} is counted and excluded`);
  }
});

test("the move-secrets scope is the same tables the count reads", () => {
  assert.deepEqual([...SECRET_SCOPE], SECRET_TABLES.map((t) => t.table));
});
