import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadMigrationEnv } from "./lib/load-env.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadMigrationEnv(root);
const { Client } = createRequire(join(root, "apps/web/package.json"))("pg");
const zombies = ["key_epochs","project_key_wraps","project_keys","resource_key_wraps","resource_keys","user_keys"];
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
// Refuse if anything is in them — they were verified empty, but this runs
// against a live database and the cost of being wrong is unrecoverable.
for (const t of zombies) {
  const { rows } = await c.query(`select count(*)::int n from public."${t}"`);
  if (rows[0].n > 0) { console.error(`REFUSING: ${t} has ${rows[0].n} rows`); process.exit(1); }
}
await c.query(`drop table if exists ${zombies.map(t => `public."${t}"`).join(", ")} cascade`);
const { rows } = await c.query("select count(*)::int n from pg_tables where schemaname='public'");
console.log(`dropped ${zombies.length} empty tables; target now has ${rows[0].n} tables`);
await c.end();
