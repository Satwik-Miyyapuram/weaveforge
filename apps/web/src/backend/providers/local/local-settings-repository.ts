import type { ICurrentUserProvider } from "@weaveforge/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseSettingsRepository,
  type Secrets,
} from "@/features/settings/infrastructure/supabase-settings-repository";
import { LOCAL_USER_ID } from "@weaveforge/core";
import type { LocalQuery } from "./pglite-client";

/**
 * Settings for a copy with no account.
 *
 * Everything but the integration credentials is an ordinary row, so only the
 * credentials are overridden. On a server they are held behind a route the
 * browser cannot read from, because the browser is not the only thing that can
 * reach the database. Here it is: the database is a file on this machine, the
 * only reader is the person at the keyboard, and a round trip to a server that
 * does not exist would simply fail.
 */
export class LocalSettingsRepository extends SupabaseSettingsRepository {
  constructor(
    db: SupabaseClient,
    session: ICurrentUserProvider,
    private readonly run: LocalQuery,
  ) {
    super(db, session);
  }

  protected override async loadSecrets(): Promise<Secrets> {
    const rows = (await this.run("select secrets from local_secrets where user_id = $1", [
      LOCAL_USER_ID,
    ])) as { secrets: Secrets | string }[];
    const stored = rows[0]?.secrets;
    if (!stored) return {};
    return typeof stored === "string" ? (JSON.parse(stored) as Secrets) : stored;
  }

  protected override async saveSecrets(secrets: Secrets): Promise<void> {
    await this.run(
      `insert into local_secrets (user_id, secrets, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set secrets = excluded.secrets, updated_at = now()`,
      [LOCAL_USER_ID, JSON.stringify(secrets)],
    );
  }
}
