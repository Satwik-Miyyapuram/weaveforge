#!/usr/bin/env node
/**
 * Can this machine reach the target Postgres?
 *
 *   DATABASE_URL=postgres://... node scripts/ping-target.mjs
 *
 * The checkpoint at the end of building the OCI box, before any data moves.
 * It answers one question, so that a failure here is unambiguous: the VM, the
 * security list, the VM's own iptables rules, and the container are either all
 * correct or they are not.
 *
 * Deliberately not part of the preflight, which needs the Supabase URL too —
 * at this point in the setup there is nothing to migrate *from* yet, and being
 * told about a missing source variable would obscure the answer.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadMigrationEnv } from "./lib/load-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadMigrationEnv(root);
const { Client } = createRequire(join(root, "apps/web/package.json"))("pg");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: Set DATABASE_URL (postgres://weaveforge:PASSWORD@YOUR_PUBLIC_IP:5432/weaveforge)");
  process.exit(1);
}

const wantsTls = !/sslmode=disable/.test(url) && !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

const client = new Client({
  connectionString: url,
  ...(wantsTls ? { ssl: { rejectUnauthorized: false } } : {}),
  connectionTimeoutMillis: 15_000,
});

/** The likely cause, named. Each of these is a different place to go looking. */
function diagnose(error) {
  const code = error.code ?? "";
  if (code === "ETIMEDOUT" || /timeout/i.test(error.message)) {
    return "A firewall is dropping packets. Check the OCI security list allows 5432\nfrom your IP, and that the VM's own iptables rules do too — Oracle's Ubuntu\nimages block everything but 22 by default.";
  }
  if (code === "ECONNREFUSED") {
    return "The port is open but nothing is listening. On the VM: `docker compose ps`.";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "That hostname does not resolve. Check the address in DATABASE_URL.";
  }
  if (/password authentication failed/i.test(error.message)) {
    return "Wrong password. It must match POSTGRES_PASSWORD in ~/weaveforge-infra/.env\non the VM. If it contains @ : / or #, those need percent-encoding in the URL.";
  }
  if (/database .* does not exist/i.test(error.message)) {
    return "Wrong database name — POSTGRES_DB in the VM's .env, `weaveforge` by default.";
  }
  if (/does not support SSL/i.test(error.message)) {
    return `Reached it, but the server has no TLS — the stock postgres image ships without a
certificate. Do not just add ?sslmode=disable: with 5432 open to the internet
that sends the password in clear text. Tunnel over SSH instead, and point
DATABASE_URL at your own machine:

  ssh -i ~/.ssh/oci_weaveforge -N -L 15432:localhost:5432 ubuntu@YOUR_PUBLIC_IP
  DATABASE_URL=postgres://weaveforge:PASSWORD@localhost:15432/weaveforge`;
  }
  return "Check the address, port, credentials, and that the container is running.";
}

try {
  await client.connect();
  const { rows } = await client.query(
    "select version() as version, (select count(*)::int from pg_tables where schemaname='public') as tables",
  );
  const { version, tables } = rows[0];
  console.log(`\n✓ Reached it.\n\n  ${version.split(",")[0]}`);
  console.log(
    tables > 0
      ? `  ${tables} tables in public — the schema is already applied.\n`
      : "  No tables yet — that is expected. `npm run migrate` applies the schema.\n",
  );
} catch (error) {
  console.error(`\n✖ Could not reach it: ${error.message}\n`);
  console.error(`${diagnose(error)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
