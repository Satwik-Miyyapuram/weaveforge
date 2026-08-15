/**
 * Contract for materialising the *signed-in* user's own rows (DIP).
 *
 * Distinct from `IAccountProvisioner`, which creates accounts for other people
 * and therefore needs privileged server access. This one creates nothing the
 * caller is not already authenticated as, so it needs no elevated credentials —
 * the database derives the identity from the verified JWT.
 *
 * It exists because sign-in and storage are two different databases in this
 * deployment: Supabase Auth issues the token, a self-hosted Postgres holds
 * every row that references the user. A brand-new account exists in the first
 * and not the second until something bridges them, and the first write it
 * attempts fails on a foreign key.
 */
export interface ISelfProvisioner {
  /**
   * Ensure the calling user's identity rows exist. Idempotent and cheap after
   * the first call, so startup may invoke it unconditionally.
   */
  ensureProvisioned(): Promise<void>;
}
