/**
 * Small helpers the one-off database and repo-check scripts share.
 *
 * TLS for a `pg` client lives in pg-tls.mjs; the full `.env.migration` loader
 * the migration scripts use lives in load-env.mjs.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `DATABASE_URL` from the environment, else from `secrets/.env.migration` (one layer of quotes stripped). */
export function loadDatabaseUrl(root = repoRoot, env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const envPath = path.join(root, "secrets", ".env.migration");
  const text = readFileSync(envPath, "utf8");
  const match = /^DATABASE_URL=(.*)$/m.exec(text);
  if (!match) throw new Error(`DATABASE_URL not found in ${envPath}`);
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/** Every file under `dir`, at any depth, whose name `keep` accepts. */
export function walkFiles(dir, keep) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, keep));
    else if (keep(name)) out.push(full);
  }
  return out;
}
