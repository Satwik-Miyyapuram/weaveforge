import { loadLocalDevEnv } from "./load-local-dev-env";

loadLocalDevEnv();

const NAMES = [
  "WEAVEFORGE_SUPABASE_URL",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
] as const;

function env(...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const val = process.env[key];
    if (val) return val;
  }
  return undefined;
}

function resolveTestPassword(): string {
  return (
    env(
      "E2E_TEST_PASSWORD",
      "TEST_ACCOUNT_PASSWORD",
      "WEAVEFORGE_PASSWORD",
      "TT_A_PASSWORD",
      "DEMO_CLIP_PASSWORD",
    ) ?? ""
  );
}

export function e2eEnabled(): boolean {
  const url = env(...NAMES);
  const emailA = env("WEAVEFORGE_EMAIL", "TT_A_EMAIL", "TEST_ACCOUNT_EMAIL_PRIMARY");
  const passwordA = env("WEAVEFORGE_PASSWORD", "TT_A_PASSWORD", "E2E_TEST_PASSWORD", "TEST_ACCOUNT_PASSWORD");
  const emailB = env("WEAVEFORGE_B_EMAIL", "TT_B_EMAIL", "WEAVEFORGE_EMAIL_B");
  const passwordB = env(
    "WEAVEFORGE_B_PASSWORD",
    "TT_B_PASSWORD",
    "E2E_TEST_PASSWORD",
    "TEST_ACCOUNT_PASSWORD",
  );
  return Boolean(url && emailA && passwordA && emailB && passwordB);
}

export function e2eUserA() {
  return {
    email: env("WEAVEFORGE_EMAIL", "TT_A_EMAIL", "TEST_ACCOUNT_EMAIL_PRIMARY")!,
    password: env("WEAVEFORGE_PASSWORD", "TT_A_PASSWORD", "E2E_TEST_PASSWORD", "TEST_ACCOUNT_PASSWORD")!,
  };
}

export function e2eUserB() {
  const password = resolveTestPassword();
  return {
    email:
      env("WEAVEFORGE_B_EMAIL", "TT_B_EMAIL", "WEAVEFORGE_EMAIL_B") ??
      "b@example.com",
    password:
      env("WEAVEFORGE_B_PASSWORD", "TT_B_PASSWORD") || password,
  };
}

/** Loaded from local-dev/test-accounts.env or env vars — never hardcoded in repo. */
export const DEFAULT_TEST_PASSWORD = resolveTestPassword();

export function e2eRecoveryPassphrase(): string {
  return env("E2E_RECOVERY_PASSPHRASE", "TEST_RECOVERY_PASSPHRASE") ?? "";
}

/** Optional one-time recovery URL for a manually prepared email-recovery E2E run. */
export function e2eRecoveryLink(): string {
  return env("E2E_RECOVERY_LINK", "TEST_RECOVERY_LINK") ?? "";
}
