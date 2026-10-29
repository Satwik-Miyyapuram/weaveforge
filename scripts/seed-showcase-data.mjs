#!/usr/bin/env node
/**
 * Populate showcase projects for the demo accounts.
 *
 *   node scripts/seed-test-users.mjs                              # first
 *   node --import tsx scripts/seed-showcase-data.mjs              # then (npm run seed:showcase)
 *   node --import tsx scripts/seed-showcase-data.mjs --dry-run    # record writes, send nothing
 *
 * Researcher:   c@example.com — full thesis workspace (100 papers, graph,
 *               lists, screening, plan, logbook, experiments, report, notes…)
 * Supervisor:   b@example.com — comment threads on c's plan and logbook;
 *               c shares its milestones with b
 * Peer:         d@example.com — milestones + logbook; shares its plan with c,
 *               gets one of c's reading lists (also b's second student)
 * Supervisees:  e@example.com, f@example.com — milestones + logbook (for c's /supervision)
 * Empty:        g@example.com — one empty showcase project (empty states)
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
 * Only the project marked `is_showcase` goes, so migration 0146 must be applied first.
 * Shares are replaced; comments from earlier runs stay on the deleted rows and never show.
 * Charts come from apps/web/public/showcase/; regenerate with
 * `python scripts/generate-showcase-charts.py`.
 *
 * --dry-run needs no env and no network: writes go to an in-memory recorder
 * and the script prints how many rows each table would get.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ensureShowcaseAssets, loadShowcaseChart, seedBlobStore } from "./lib/showcase-images.mjs";
import {
  resetShowcaseProject,
  seedCollabShowcase,
  seedShowcase,
  seedSuperviseeShowcase,
} from "../apps/web/src/features/showcase/infrastructure/seed-showcase.ts";
import { createRecordingDb } from "../apps/web/src/features/showcase/infrastructure/recording-db.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");

const USERS = {
  supervisor: "b@example.com",
  phd: "c@example.com",
  peer: "d@example.com",
  mastersE: "e@example.com",
  mastersF: "f@example.com",
  empty: "g@example.com",
};
const EMPTY_PROJECT = "Empty project";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

/** The live service-role client and the helpers that need it. */
function liveTarget() {
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

  const tiered = (process.env.NEXT_PUBLIC_BLOB_PROVIDER ?? process.env.BLOB_PROVIDER) === "tiered";
  return {
    db: admin,
    userId,
    store: async (email) => seedBlobStore(admin, tiered ? await seedUserSession(email) : null),
    chart: async (kind) => loadShowcaseChart(kind),
    report: () => {},
  };
}

/** An in-memory target: fake user ids, recorded writes, a summary at the end. */
function dryTarget() {
  const rec = createRecordingDb();
  const uploads = [];
  const ids = new Map();
  return {
    db: rec.db,
    userId: async (email) => {
      if (!ids.has(email)) ids.set(email, crypto.randomUUID());
      return ids.get(email);
    },
    store: async () => ({ upload: async (bucket, path) => uploads.push(`${bucket}/${path}`) }),
    chart: async () => new Uint8Array([137, 80, 78, 71]),
    report: () => {
      const counts = {};
      for (const w of rec.writes) {
        const k = `${w.op} ${w.table}`;
        counts[k] = (counts[k] ?? 0) + (w.rows?.length ?? 1);
      }
      console.log("Dry run — nothing was sent. Rows per table:");
      for (const [k, n] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(32)} ${n}`);
      console.log(`  ${"uploads".padEnd(32)} ${uploads.length}`);
    },
  };
}

async function main() {
  const target = dryRun ? dryTarget() : liveTarget();
  if (!dryRun) ensureShowcaseAssets();
  const { db } = target;
  const log = (line) => console.log(`  ${line}`);

  console.log(`Seeding ${USERS.phd} …`);
  const phd = await target.userId(USERS.phd);
  const seeded = await seedShowcase({ db, userId: phd, store: await target.store(USERS.phd), chart: target.chart, log });

  for (const [label, email] of [
    ["PhD D", USERS.peer],
    ["Masters E", USERS.mastersE],
    ["Masters F", USERS.mastersF],
  ]) {
    console.log(`Seeding ${email} …`);
    await seedSuperviseeShowcase({ db, userId: await target.userId(email), label, log });
  }

  console.log(`Seeding ${USERS.empty} …`);
  log(`project ${EMPTY_PROJECT} → ${await resetShowcaseProject(db, await target.userId(USERS.empty), EMPTY_PROJECT)}`);

  console.log(`Seeding supervision and sharing (${USERS.supervisor}, ${USERS.phd}, ${USERS.peer}) …`);
  await seedCollabShowcase({
    db,
    researcherId: phd,
    supervisorId: await target.userId(USERS.supervisor),
    peerId: await target.userId(USERS.peer),
    seeded,
    log,
  });

  target.report();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
