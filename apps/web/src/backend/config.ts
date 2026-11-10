import type { BackendConfigField } from "@weaveforge/wasm";

import { readyCore } from "@/lib/rust-core";

/** Active persistence + auth backend — swap by env without touching features. */
type BackendProviderId = "postgrest" | "postgres";

/** Env bag for tests and composition-root overrides (avoids full ProcessEnv in unit tests). */
export type EnvReader = Record<string, string | undefined>;

export interface BackendConfig {
  readonly provider: BackendProviderId;
  /** Supabase Auth project URL; sign-in only. */
  readonly supabaseUrl?: string;
  /**
   * Where the PostgREST data API lives.
   *
   * Auth stays at `supabaseUrl`: tokens are issued by Supabase Auth, and the
   * self-hosted PostgREST validates them with the same JWT secret.
   *
   * Production sets it to the OCI server (`https://api.weaveforge.org`); the
   * sign-in project holds no WeaveForge data. Unset means "same as
   * `supabaseUrl`", which only a fresh checkout or a test would want.
   */
  readonly dataUrl?: string;
  /**
   * Where the realtime service lives.
   *
   * Broadcast channels are authorized by RLS policies on `realtime.messages`,
   * and those policies read the application tables (`can_view_resource`). They
   * therefore have to run against the database that actually holds the data:
   * a realtime elsewhere would authorize against the wrong database.
   *
   * Production sets it beside `dataUrl`. Unset means "same as `supabaseUrl`".
   */
  readonly realtimeUrl?: string;
  /** Supabase Auth anon/public key; sign-in only. */
  readonly supabaseAnonKey?: string;
  /** Service role key — server routes only (optional in browser bundle). */
  readonly supabaseServiceRoleKey?: string;
  /** JWT secret — server routes only; mints RLS sessions for API tokens. */
  readonly supabaseJwtSecret?: string;
  /** Server-only key used to encrypt the non-E2EE Overleaf integration token. */
  readonly overleafCredentialKey?: string;
  /**
   * Postgres connection string for self-hosted / Hyperdrive / Oracle Cloud.
   * Required when provider = postgres, which selects the server-side blob
   * registry; table data reaches Postgres over PostgREST via `dataUrl`.
   */
  readonly databaseUrl?: string;
}

const PROVIDERS = ["postgrest", "postgres"] as const;

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

function fromEnv(env: EnvReader): BackendConfig {
  const provider = pick(env.NEXT_PUBLIC_BACKEND_PROVIDER, PROVIDERS, "postgrest");
  return {
    provider,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    dataUrl: env.NEXT_PUBLIC_DATA_URL,
    realtimeUrl: env.NEXT_PUBLIC_REALTIME_URL,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseJwtSecret: env.SUPABASE_JWT_SECRET,
    overleafCredentialKey: env.OVERLEAF_CREDENTIAL_KEY,
    databaseUrl: env.DATABASE_URL,
  };
}

/** Config fields that can be required (names as in the Rust `ConfigField`). */
export type ConfigField = BackendConfigField;

/**
 * Names which env vars are absent — never their values. One of these is the
 * service-role key, and these messages reach the browser. Ported to Rust
 * (`backend_config`); this wrapper only supplies the loaded core.
 */
export function missingConfigMessage(cfg: BackendConfig, required: readonly ConfigField[]): string | null {
  return readyCore().missingConfigMessage(cfg, required);
}

/** Read backend selection from env (composition root only). */
export function readBackendConfig(env?: EnvReader): BackendConfig {
  if (env) return fromEnv(env);
  // Direct process.env access so Next.js inlines NEXT_PUBLIC_* in the client bundle.
  //
  // Every NEXT_PUBLIC_* the browser needs must be spelled out here, literally.
  // `fromEnv` above reads the same names off a passed-in bag, which is why
  // tests and server callers saw `dataUrl` while the browser never did: Next
  // only substitutes `process.env.NEXT_PUBLIC_X` when it appears verbatim in
  // the source, so a value reached through a variable is simply absent from the
  // bundle. Omitting `dataUrl` here made the cutover switch a no-op — setting
  // it in Vercel changed nothing, with no error to explain why.
  return {
    provider: pick(process.env.NEXT_PUBLIC_BACKEND_PROVIDER, PROVIDERS, "postgrest"),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    dataUrl: process.env.NEXT_PUBLIC_DATA_URL,
    realtimeUrl: process.env.NEXT_PUBLIC_REALTIME_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET,
    overleafCredentialKey: process.env.OVERLEAF_CREDENTIAL_KEY,
    databaseUrl: process.env.DATABASE_URL,
  };
}
