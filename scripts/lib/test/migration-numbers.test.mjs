// A migration number names one migration: a held file (db/held) must not reuse
// a number from db/migrations, or promoting it collides (F97-P2-16).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** `[number, file]` for each forward migration in `dir` (rollbacks share their number). */
function numbered(dir) {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name) && !name.endsWith(".rollback.sql"))
    .map((name) => [name.slice(0, 4), `${dir}/${name}`]);
}

test("no migration number is used twice across db/migrations and db/held", () => {
  const seen = new Map();
  const clashes = [];
  for (const [number, file] of [...numbered("db/migrations"), ...numbered("db/held")]) {
    if (seen.has(number)) clashes.push(`${seen.get(number)} and ${file}`);
    else seen.set(number, file);
  }
  assert.deepEqual(clashes, []);
});

test("db/held says what it is for and how a file is promoted", () => {
  assert.ok(existsSync(join(root, "db/held/README.md")));
});
