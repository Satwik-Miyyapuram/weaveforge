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

/**
 * Enough credentials for a spec that signs one user in — which is all of them
 * but sharing.
 *
 * This used to demand user B as well, so a checkout with only the first account
 * skipped every spec, and a skip reads as a pass. That is how the whole suite
 * ran green in CI while proving nothing: the workflow passed A's secrets and
 * not B's.
 */
export function e2eEnabled(): boolean {
  const url = env(...NAMES);
  const emailA = env("WEAVEFORGE_EMAIL", "TT_A_EMAIL", "TEST_ACCOUNT_EMAIL_PRIMARY");
  const passwordA = env("WEAVEFORGE_PASSWORD", "TT_A_PASSWORD", "E2E_TEST_PASSWORD", "TEST_ACCOUNT_PASSWORD");
  return Boolean(url && emailA && passwordA);
}

/** The second account, which only the sharing spec has any use for. */
export function e2eTwoUsersEnabled(): boolean {
  const emailB = env("WEAVEFORGE_B_EMAIL", "TT_B_EMAIL", "WEAVEFORGE_EMAIL_B", "TEST_ACCOUNT_EMAIL_SECONDARY");
  const passwordB = env(
    "WEAVEFORGE_B_PASSWORD",
    "TT_B_PASSWORD",
    "E2E_TEST_PASSWORD",
    "TEST_ACCOUNT_PASSWORD",
  );
  return e2eEnabled() && Boolean(emailB && passwordB);
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
      env("WEAVEFORGE_B_EMAIL", "TT_B_EMAIL", "WEAVEFORGE_EMAIL_B", "TEST_ACCOUNT_EMAIL_SECONDARY") ??
      "b@example.com",
    password:
      env("WEAVEFORGE_B_PASSWORD", "TT_B_PASSWORD") || password,
  };
}

/** Loaded from local-dev/test-accounts.env or env vars — never hardcoded in repo. */
export const DEFAULT_TEST_PASSWORD = resolveTestPassword();
