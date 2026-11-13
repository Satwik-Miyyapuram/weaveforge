/**
 * Publish the in-app release notice for a version. Reads that version's
 * section from CHANGELOG.md and upserts it into `release_notices` on the OCI
 * Postgres. Without `--apply` it only prints the SQL.
 *
 *   WF_OCI_SSH=user@host node scripts/publish-release-notice.mjs 0.9.0 [--apply]
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/;
const TAG = "$wfnote$";

// Backslash-dollar keeps the vars for the container shell, not the local one.
export const REMOTE_COMMAND =
  'docker exec -i weaveforge-postgres sh -c "psql -1 -v ON_ERROR_STOP=1 -U \\${POSTGRES_USER} -d \\${POSTGRES_DB}"';

export function extractSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = `## [${version}]`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const body = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith("## ["); i++) {
    body.push(lines[i]);
  }
  const section = body.join("\n").trim();
  if (!section) throw new Error(`CHANGELOG.md section ${version} is empty`);
  return section;
}

export function buildSql(version, title, body) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`invalid version: ${version}`);
  for (const value of [version, title, body]) {
    if (value.includes(TAG)) throw new Error(`value contains ${TAG}; cannot dollar-quote`);
  }
  return `insert into release_notices (version, title, body) values (${TAG}${version}${TAG}, ${TAG}${title}${TAG}, ${TAG}${body}${TAG}) on conflict (version) do update set title = excluded.title, body = excluded.body, published_at = now();\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const version = args.find((arg) => arg !== "--apply");
  if (!version) {
    process.stderr.write("usage: publish-release-notice.mjs <version> [--apply]\n");
    process.exit(1);
  }
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const sql = buildSql(version, `WeaveForge ${version}`, extractSection(changelog, version));

  if (!apply) {
    process.stdout.write(sql);
    process.stderr.write("Dry run. Re-run with --apply to insert (needs WF_OCI_SSH).\n");
    return;
  }

  const host = process.env.WF_OCI_SSH;
  if (!host) {
    process.stderr.write("WF_OCI_SSH is not set (e.g. user@host).\n");
    process.exit(1);
  }
  const child = spawn("ssh", [host, REMOTE_COMMAND], { stdio: ["pipe", "inherit", "inherit"] });
  child.on("error", (err) => {
    process.stderr.write(`ssh failed to start: ${err.message}\n`);
    process.exit(1);
  });
  child.on("close", (code) => process.exit(code ?? 1));
  child.stdin.end(sql);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
