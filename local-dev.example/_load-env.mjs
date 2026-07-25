import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dir, "..");

function parseEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (val === "" && key !== "TEST_ACCOUNT_PASSWORD") continue;
    if (!process.env[key]) process.env[key] = val;
  }
}

parseEnvFile(resolve(__dir, "test-accounts.env"));
parseEnvFile(resolve(REPO, "apps/web/.env.local"));

export function requireTestPassword() {
  const password = process.env.TEST_ACCOUNT_PASSWORD?.trim();
  if (!password || password === "change-me-locally") {
    console.error("Set TEST_ACCOUNT_PASSWORD in local-dev/test-accounts.env");
    process.exit(1);
  }
  return password;
}

export function primaryTestEmail() {
  return process.env.TEST_ACCOUNT_EMAIL_PRIMARY?.trim() || "c@example.com";
}

export function requireSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local");
    process.exit(1);
  }
  return { url, key };
}

export { REPO };
