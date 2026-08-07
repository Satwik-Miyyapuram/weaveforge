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
let total = 0;
for (const t of zombies) {
  const { rows } = await c.query(`select count(*)::int n from public."${t}"`);
  console.log(`${t.padEnd(24)} ${rows[0].n} rows`);
  total += rows[0].n;
}
console.log(`TOTAL ROWS IN ZOMBIE TABLES: ${total}`);
await c.end();
