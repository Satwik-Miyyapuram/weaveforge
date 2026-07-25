#!/usr/bin/env node
/**
 * Mint API token for primary test account and run Python SDK integration tests.
 *
 *   node scripts/test-sdk-account-c.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { primaryTestEmail, requireTestPassword, REPO } from "./_load-env.mjs";

const TEST_EMAIL = primaryTestEmail();
const TEST_PASSWORD = requireTestPassword();
const API_URL = process.env.THESIS_TRACKER_API_URL || "http://localhost:3000";
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

async function main() {
  const env = loadEnv(ENV_PATH);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or ANON key in apps/web/.env.local");
    process.exit(1);
  }

  const canMintApiToken = !!env.SUPABASE_JWT_SECRET;
  if (!canMintApiToken) {
    console.warn("SUPABASE_JWT_SECRET not set — using session JWT for SDK test.");
  }

  const health = await fetch(`${API_URL}/api/sdk/whoami`).catch(() => null);
  if (!health) {
    console.error(`Web app not reachable at ${API_URL}. Start with: npm run dev`);
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

  const session = data.session.access_token;
  let sdkToken = session;
  let tokenRecord = null;

  if (canMintApiToken) {
    const tokenRes = await fetch(`${API_URL}/api/settings/api-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `sdk-test-${Date.now()}`, expiresInDays: 1 }),
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenBody.plaintext) {
      console.error("Failed to create API token:", tokenBody.error ?? tokenRes.statusText);
      process.exit(1);
    }
    sdkToken = tokenBody.plaintext;
    tokenRecord = tokenBody.record;
    console.log(`Created API token for ${TEST_EMAIL}.`);
  } else {
    console.log(`Using session JWT for ${TEST_EMAIL} SDK test.`);
  }

  const pytest = spawnSync(
    "pytest",
    ["tests/test_integration_api.py", "-v", "--tb=short"],
    {
      cwd: resolve(REPO, "python"),
      env: {
        ...process.env,
        THESIS_TRACKER_TOKEN: sdkToken,
        THESIS_TRACKER_API_URL: API_URL,
        THESIS_TRACKER_TEST_USER_EMAIL: TEST_EMAIL,
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  if (tokenRecord?.id) {
    await fetch(`${API_URL}/api/settings/api-tokens?id=${encodeURIComponent(tokenRecord.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session}` },
    }).catch(() => {});
  }

  process.exit(pytest.status ?? 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
