#!/usr/bin/env node
/**
 * Sign in as primary test account and stream a live dummy experiment.
 *
 *   node scripts/live-dummy-experiment-c.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { primaryTestEmail, requireTestPassword, REPO } from "./_load-env.mjs";

const TEST_EMAIL = primaryTestEmail();
const TEST_PASSWORD = requireTestPassword();
const ENV_PATH = resolve(REPO, "apps/web/.env.local");

function loadEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function resolveApiUrl() {
  if (process.env.WEAVEFORGE_API_URL) {
    return process.env.WEAVEFORGE_API_URL.replace(/\/$/, "");
  }
  for (const port of [3001, 3000]) {
    const base = `http://localhost:${port}`;
    try {
      const res = await fetch(`${base}/api/sdk/whoami`, { signal: AbortSignal.timeout(1500) });
      if (res.status === 401 || res.status === 200) return base;
    } catch {
      /* try next port */
    }
  }
  return "http://localhost:3000";
}

async function main() {
  const apiUrl = await resolveApiUrl();

  let token = process.env.WEAVEFORGE_TOKEN?.trim();
  if (!token) {
    const env = loadEnv(ENV_PATH);
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      console.error("Missing Supabase keys in apps/web/.env.local");
      process.exit(1);
    }

    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (error || !data.session?.access_token) {
      console.error(`Sign-in failed for ${TEST_EMAIL}:`, error?.message ?? "no session");
      console.error("Run: node scripts/seed-test-users.mjs");
      process.exit(1);
    }
    token = data.session.access_token;
    console.log(`Signed in as ${TEST_EMAIL}`);
  } else {
    console.log("Using WEAVEFORGE_TOKEN from environment");
  }

  console.log(`API: ${apiUrl}`);
  console.log("Creating timestamped experiment and streaming metrics…\n");

  const py = process.platform === "win32" ? "python" : "python3";
  const child = spawn(py, ["examples/live_dummy_run.py"], {
    cwd: resolve(REPO, "python"),
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      KMP_DUPLICATE_LIB_OK: process.env.KMP_DUPLICATE_LIB_OK || "TRUE",
      MPLBACKEND: process.env.MPLBACKEND || "Agg",
      ...(process.env.WANDB_API_KEY?.trim()
        ? {}
        : { WANDB_MODE: "disabled", WANDB_SILENT: "true" }),
      WEAVEFORGE_TOKEN: token,
      WEAVEFORGE_API_URL: apiUrl,
      LIVE_DUMMY_STEP_SEC: process.env.LIVE_DUMMY_STEP_SEC || "3",
      LIVE_DUMMY_STEPS: process.env.LIVE_DUMMY_STEPS || "40",
    },
    stdio: "inherit",
  });

  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
