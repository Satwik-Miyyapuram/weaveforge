#!/usr/bin/env node
/**
 * Populate showcase projects for the demo accounts.
 *
 *   node scripts/seed-test-users.mjs                    # first
 *   node --import tsx scripts/seed-showcase-data.mjs    # then (npm run seed:showcase)
 *
 * Primary account: c@example.com — full thesis workspace (36 papers, graph,
 *                  lists, screening, plan, logbook, experiments, report, vault…)
 * Supervisees:     e@example.com, f@example.com — milestones + logbook (for /supervision)
 *
 * The dataset and the seeder are shared with the desktop app's
 * "Load demo workspace" button: apps/web/src/features/showcase.
 *
 * Rows go to the data API (NEXT_PUBLIC_DATA_URL — the OCI PostgREST — or
 * Supabase when unset) with the service role. Files go through the deployed
 * app's blob routes as the demo user when storage is tiered, so the same R2
 * credentials the app uses serve them; set SHOWCASE_APP_URL to point at a
 * different deployment (default https://app.weaveforge.org). The demo user's
 * password is read from local-dev/test-accounts.env (TEST_ACCOUNT_PASSWORD).
 *
 * Re-running replaces the "MSc Thesis (Showcase)" project per user (cascade delete).
 * Charts come from apps/web/public/showcase/; regenerate with
 * `python scripts/generate-showcase-charts.py`.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ensureShowcaseAssets, loadShowcaseChart, seedBlobStore } from "./lib/showcase-images.mjs";
import { seedShowcase, seedSuperviseeShowcase } from "../apps/web/src/features/showcase/infrastructure/seed-showcase.ts";

const __dir = dirname(fileURLToPath(import.meta.url));

const USERS = {
  phd: "c@example.com",
  mastersE: "e@example.com",
  mastersF: "f@example.com",
};

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(resolve(__dir, "../apps/web/.env.local"));
loadEnvFile(resolve(__dir, "../local-dev/test-accounts.env"));

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dataUrl = process.env.NEXT_PUBLIC_DATA_URL;
const appUrl = process.env.SHOWCASE_APP_URL ?? "https://app.weaveforge.org";
const password = process.env.TEST_ACCOUNT_PASSWORD;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or apps/web/.env.local)");
  process.exit(1);
}

/** Table traffic goes to the data API when one is set; auth admin stays at Supabase. */
function dataFetch() {
  if (!dataUrl || dataUrl === url) return undefined;
  const restPrefix = `${url.replace(/\/$/, "")}/rest/v1`;
  const base = dataUrl.replace(/\/$/, "");
  return (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return fetch(href.startsWith(restPrefix) ? `${base}${href.slice(restPrefix.length)}` : input, init);
  };
}

const admin = createClient(url, key, { auth: { persistSession: false }, global: { fetch: dataFetch() } });

/** Sign in as a demo user so blob uploads can go through the app as them. */
async function seedUserSession(email) {
  if (!anonKey || !password) {
    throw new Error("Need NEXT_PUBLIC_SUPABASE_ANON_KEY and TEST_ACCOUNT_PASSWORD (local-dev/test-accounts.env) to sign in.");
  }
  const user = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await user.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return { accessToken: data.session.access_token, appUrl };
}

async function userId(email) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u) throw new Error(`No user ${email} — run: node scripts/seed-test-users.mjs`);
  return u.id;
}

async function main() {
  ensureShowcaseAssets();
  const log = (line) => console.log(`  ${line}`);

  console.log(`Seeding ${USERS.phd} …`);
  const phd = await userId(USERS.phd);
  const tiered = (process.env.NEXT_PUBLIC_BLOB_PROVIDER ?? process.env.BLOB_PROVIDER) === "tiered";
  await seedShowcase({
    db: admin,
    userId: phd,
    store: seedBlobStore(admin, tiered ? await seedUserSession(USERS.phd) : null),
    chart: async (kind) => loadShowcaseChart(kind),
    log,
  });

  for (const [label, email] of [
    ["Masters E", USERS.mastersE],
    ["Masters F", USERS.mastersF],
  ]) {
    console.log(`Seeding ${email} …`);
    const uid = await userId(email);
    await seedSuperviseeShowcase({ db: admin, userId: uid, label, log });
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
