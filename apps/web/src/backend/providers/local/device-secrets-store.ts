import { LOCAL_USER_ID } from "@weaveforge/core";
import type { Secrets, SecretsStore } from "@/features/settings/infrastructure/supabase-settings-repository";
import { LocalRunner } from "./local-runner";
import type { LocalQuery } from "./pglite-client";

/**
 * Integration credentials kept on the machine that holds the database.
 *
 * For a deployment with no server that can answer `/api/settings/credentials`:
 * a static export holds `src/app/api/` aside (`apps/desktop/scripts/build-web.mjs`),
 * so the route is not in the bundle at all and a fetch for it reaches the
 * `app://` file handler instead. What came back was a 404 with an empty body,
 * which the route store could only turn into "Failed to save integration
 * credentials." — and because `save()` writes the secrets before the row, no
 * setting was saved either.
 *
 * The row is this *device's*, not the account's: one per machine, under
 * `LOCAL_USER_ID`, the same identity the shell applies when it opens the
 * database. It is protected by the file permissions on the app's data directory
 * and nothing else, which is what Settings tells the reader and what
 * `docs/using/desktop.md` promises. So a credential entered here does not follow
 * the account to another machine — the account's own copy is still the one the
 * website writes, through the route.
 *
 * This is deliberately not "the local-mode store". The desktop shell applies
 * `supabase/migrations-local` on every launch, signed in or not, so the table
 * exists either way — and the question that picks this store is whether the
 * deployment has routes of its own, never which mode a window is in.
 */
export class DeviceSecretsStore implements SecretsStore {
  constructor(private readonly run: LocalQuery = defaultQuery()) {}

  async load(): Promise<Secrets> {
    const rows = (await this.run("select secrets from local_secrets where user_id = $1", [
      LOCAL_USER_ID,
    ])) as { secrets: Secrets | string }[];
    const stored = rows[0]?.secrets;
    if (!stored) return {};
    return typeof stored === "string" ? (JSON.parse(stored) as Secrets) : stored;
  }

  async save(secrets: Secrets): Promise<void> {
    await this.run(
      `insert into local_secrets (user_id, secrets, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set secrets = excluded.secrets, updated_at = now()`,
      [LOCAL_USER_ID, JSON.stringify(secrets)],
    );
  }
}

/** Straight to the shell. The identity is applied on the far side, not here. */
function defaultQuery(): LocalQuery {
  const runner = new LocalRunner();
  return (sql, params) => runner.query(sql, params as never[]);
}
