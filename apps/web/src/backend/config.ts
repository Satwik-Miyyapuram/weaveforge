/** Active persistence + auth backend — swap by env without touching features. */
export type BackendProviderId = "supabase" | "postgres";

/** Env bag for tests and composition-root overrides (avoids full ProcessEnv in unit tests). */
export type EnvReader = Record<string, string | undefined>;

export interface BackendConfig {
  readonly provider: BackendProviderId;
  /** Supabase project URL (required when provider = supabase). */
  readonly supabaseUrl?: string;
  /** Supabase anon/public key (required when provider = supabase). */
  readonly supabaseAnonKey?: string;
  /** Service role key — server routes only (optional in browser bundle). */
  readonly supabaseServiceRoleKey?: string;
  /** JWT secret — server routes only; mints RLS sessions for API tokens. */
  readonly supabaseJwtSecret?: string;
  /** Server-only key used to encrypt the non-E2EE Overleaf integration token. */
  readonly overleafCredentialKey?: string;
  /**
   * Postgres connection string for self-hosted / Hyperdrive / Oracle Cloud.
   * Required when provider = postgres (not yet implemented in adapters).
   */
  readonly databaseUrl?: string;
}

const PROVIDERS = ["supabase", "postgres"] as const;

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

function fromEnv(env: EnvReader): BackendConfig {
  const provider = pick(env.NEXT_PUBLIC_BACKEND_PROVIDER, PROVIDERS, "supabase");
  return {
    provider,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseJwtSecret: env.SUPABASE_JWT_SECRET,
    overleafCredentialKey: env.OVERLEAF_CREDENTIAL_KEY,
    databaseUrl: env.DATABASE_URL,
  };
}

/** The env var each config field comes from, for naming what is absent. */
const ENV_VAR_NAMES = {
  supabaseUrl: "NEXT_PUBLIC_SUPABASE_URL",
  supabaseAnonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  supabaseServiceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
  supabaseJwtSecret: "SUPABASE_JWT_SECRET",
  overleafCredentialKey: "OVERLEAF_CREDENTIAL_KEY",
  databaseUrl: "DATABASE_URL",
} as const;

export type ConfigField = keyof typeof ENV_VAR_NAMES;

/** Names of the required fields that are absent, in the order given. */
export function missingConfig(cfg: BackendConfig, required: readonly ConfigField[]): string[] {
  return required.filter((field) => !cfg[field]).map((field) => ENV_VAR_NAMES[field]);
}

/**
 * Names which env vars are absent — never their values. One of these is the
 * service-role key, and these messages reach the browser.
 *
 * Worth the words: a variable scoped to Production only is invisible on Preview
 * deployments, and a message that just says "missing config" gives no way to
 * tell that apart from a bad key or a broken integration.
 */
export function missingConfigMessage(cfg: BackendConfig, required: readonly ConfigField[]): string | null {
  const missing = missingConfig(cfg, required);
  if (!missing.length) return null;
  return `Missing server config: ${missing.join(", ")}. Set ${
    missing.length > 1 ? "these" : "this"
  } for the environment this deployment runs in (a Production-only variable is absent on Preview builds), then redeploy.`;
}

/** Read backend selection from env (composition root only). */
export function readBackendConfig(env?: EnvReader): BackendConfig {
  if (env) return fromEnv(env);
  // Direct process.env access so Next.js inlines NEXT_PUBLIC_* in the client bundle.
  return {
    provider: pick(process.env.NEXT_PUBLIC_BACKEND_PROVIDER, PROVIDERS, "supabase"),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET,
    overleafCredentialKey: process.env.OVERLEAF_CREDENTIAL_KEY,
    databaseUrl: process.env.DATABASE_URL,
  };
}
