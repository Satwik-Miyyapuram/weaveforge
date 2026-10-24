import type { ICurrentUserProvider } from "@weaveforge/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMPTY_SETTINGS,
  hydrateUserSettings,
  parseUserAppearance,
  normalizeAiAccessSettings,
  type SettingsMetadata,
  type ISettingsRepository,
  type UserSettings,
} from "@weaveforge/core";
import { run } from "@/backend/providers/postgrest/row-access";

/**
 * PostgREST implementation of ISettingsRepository. One row per user; user_id is
 * filled by the column default auth.uid(). Non-secret fields are read/written
 * directly; integration credentials (Zotero / GitLab / Semantic Scholar) go
 * through a `SecretsStore` — by default the server route that seals them with a
 * server-held key, and on a deployment with no routes of its own, this machine
 * (see `SecretsStore`).
 */

/**
 * The columns a SettingsRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const SETTINGS_COLUMNS = "user_id,zotero_library,disclaimer_accepted_at,disclaimer_version,appearance,ai_access";

interface SettingsRow {
  user_id: string;
  zotero_library: string | null;
  disclaimer_accepted_at: string | null;
  disclaimer_version: number | null;
  appearance: Record<string, unknown> | null;
  ai_access: Record<string, unknown> | null;
}

export type Secrets = Pick<UserSettings, "zoteroApiKey" | "semanticScholarKey" | "integrations">;

const TABLE = "user_settings";
const CREDENTIALS_ROUTE = "/api/settings/credentials";

/**
 * Where integration credentials are kept.
 *
 * A seam rather than two `protected` methods on the repository, because the
 * question it answers is *"does this deployment have a server that can answer
 * its own routes"* and not *"is this window working without an account"*. Those
 * are two different questions, and answering the second one when the first was
 * meant is what broke saving credentials in the desktop app: the window was
 * signed in, so it took the server path, and the static export holds
 * `src/app/api/` aside (`apps/desktop/scripts/build-web.mjs`). The request
 * reached the `app://` handler, which can only serve files out of the bundle,
 * and came back a 404 with an empty body — which `saveSecrets` can only report
 * as the generic "Failed to save integration credentials.".
 *
 * `apps/desktop/src/main.ts` applies `db/migrations-local` on every
 * launch, so the alternative store below is always available on a machine that
 * has the local database, signed in or not.
 */
export interface SecretsStore {
  load(): Promise<Secrets>;
  save(secrets: Secrets): Promise<void>;
}

/**
 * The server route, which seals credentials with a key the browser never holds.
 *
 * Correct wherever there is a server, and the only store whose contents follow
 * the account to another device.
 */
export class RouteSecretsStore implements SecretsStore {
  constructor(private readonly db: SupabaseClient) {}

  private async authHeader(): Promise<Record<string, string>> {
    const { data } = await this.db.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async load(): Promise<Secrets> {
    const res = await fetch(CREDENTIALS_ROUTE, { headers: await this.authHeader() });
    // A failed read is not "no keys": shown as none, the next save would seal
    // that empty set over every stored credential.
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Failed to load integration credentials.");
    }
    return (await res.json()) as Secrets;
  }

  async save(secrets: Secrets): Promise<void> {
    const res = await fetch(CREDENTIALS_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await this.authHeader()) },
      body: JSON.stringify(secrets),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Failed to save integration credentials.");
    }
  }
}

/**
 * The metadata row, briefly memoized across repository instances.
 *
 * Two unrelated consumers read it during boot — the startup bundle, to decide
 * the privacy gate, and theme hydration, to apply saved appearance — through
 * two different containers (light and full), so neither could see the other's
 * request. The window only has to span a page load; `save()` drops it, so a
 * write is never read back stale.
 *
 * The window is a minute rather than seconds because the two reads are not
 * close together: theme hydration waits for the full container (~17 chunks),
 * which on a cold load lands well after the startup bundle has decided the
 * gate.
 *
 * Each memo names the user it was read for and answers only that user: the
 * settings hold decrypted integration keys, and a sign-in as someone else
 * inside the minute must not be handed them.
 */
type Memo<T> = { at: number; userId: string | null; value: Promise<T> };
let metadataMemo: Memo<SettingsMetadata> | null = null;
let settingsMemo: Memo<UserSettings> | null = null;
const METADATA_MEMO_MS = 60_000;

function forgetSettingsMetadata(): void {
  metadataMemo = null;
  settingsMemo = null;
}

function fresh<T>(memo: Memo<T> | null, userId: string | null, now: number): memo is Memo<T> {
  return memo !== null && memo.userId === userId && now - memo.at < METADATA_MEMO_MS;
}

export class PostgrestSettingsRepository implements ISettingsRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
    /** Defaults to the server route; see `SecretsStore` for when it must not. */
    private readonly secrets: SecretsStore = new RouteSecretsStore(db),
  ) {}

  /**
   * Full settings, memoized like the metadata read.
   *
   * Every integration credential lookup goes through here — Zotero, Semantic
   * Scholar, the bibliography sync, the settings screen itself — and each one
   * cost a `user_settings` row plus a `/api/settings/credentials` round trip.
   * Opening Settings made nine of the first and five of the second.
   */
  async get(): Promise<UserSettings> {
    const userId = await this.session.getCurrentUserId();
    const now = Date.now();
    if (fresh(settingsMemo, userId, now)) return settingsMemo.value;
    const value = this.readSettings();
    settingsMemo = { at: now, userId, value };
    void value.catch(() => {
      if (settingsMemo?.value === value) settingsMemo = null;
    });
    return value;
  }

  private async readSettings(): Promise<UserSettings> {
    const row = await this.readRow();
    if (!row) return { ...EMPTY_SETTINGS };
    return this.fromRow(row, await this.secrets.load());
  }

  /** The `user_settings` row alone, without the credentials round trip. */
  private async readRow(): Promise<SettingsRow | null> {
    const { data, error } = await this.db.from(TABLE).select(SETTINGS_COLUMNS).maybeSingle();
    if (error) throw error;
    return (data as SettingsRow | null) ?? null;
  }

  private fromRow(row: SettingsRow, secrets: Secrets): UserSettings {
    return hydrateUserSettings({
      zoteroApiKey: secrets.zoteroApiKey ?? undefined,
      zoteroLibrary: row.zotero_library ?? undefined,
      semanticScholarKey: secrets.semanticScholarKey ?? undefined,
      integrations: secrets.integrations ?? undefined,
      disclaimerAcceptedAt: row.disclaimer_accepted_at ?? undefined,
      disclaimerVersion: row.disclaimer_version ?? undefined,
      appearance: parseUserAppearance(row.appearance) ?? undefined,
      aiAccess: row.ai_access ? normalizeAiAccessSettings(row.ai_access as never) : undefined,
    });
  }

  async getMetadata(): Promise<SettingsMetadata> {
    const userId = await this.session.getCurrentUserId();
    const now = Date.now();
    if (fresh(metadataMemo, userId, now)) return metadataMemo.value;
    const value = this.readMetadata();
    metadataMemo = { at: now, userId, value };
    // A failed read must not be remembered as an answer.
    void value.catch(() => {
      if (metadataMemo?.value === value) forgetSettingsMetadata();
    });
    return value;
  }

  private async readMetadata(): Promise<SettingsMetadata> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("disclaimer_accepted_at, disclaimer_version, appearance")
      .maybeSingle();
    if (error) throw error;
    if (!data) return {};
    const row = data as Pick<SettingsRow, "disclaimer_accepted_at" | "disclaimer_version" | "appearance">;
    return {
      disclaimerAcceptedAt: row.disclaimer_accepted_at ?? undefined,
      disclaimerVersion: row.disclaimer_version ?? undefined,
      appearance: parseUserAppearance(row.appearance) ?? undefined,
    };
  }

  async save(settings: UserSettings): Promise<void> {
    const userId = await this.session.requireUserId();
    // Read through, not from the memo: this is a read-modify-write, and merging
    // onto a minute-old copy could drop a field another tab just wrote. Only the
    // row is merged; the secrets below are replaced, so they are not read.
    const row = await this.readRow();
    const existing = row ? this.fromRow(row, {}) : EMPTY_SETTINGS;
    // Seal secrets first (owns credentials_enc + clears plaintext).
    await this.secrets.save({
      zoteroApiKey: settings.zoteroApiKey,
      semanticScholarKey: settings.semanticScholarKey,
      integrations: settings.integrations,
    });
    // Non-secret fields (credentials_enc is left untouched by this upsert).
    await run(this.db.from(TABLE).upsert(
      {
        user_id: userId,
        zotero_library: settings.zoteroLibrary ?? null,
        disclaimer_accepted_at: settings.disclaimerAcceptedAt ?? existing.disclaimerAcceptedAt ?? null,
        disclaimer_version: settings.disclaimerVersion ?? existing.disclaimerVersion ?? null,
        appearance: settings.appearance ?? existing.appearance ?? null,
        ai_access: settings.aiAccess ?? existing.aiAccess ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    ));
    forgetSettingsMetadata();
  }

  async saveDisclaimer(acceptedAt: string, version: number): Promise<void> {
    const userId = await this.session.requireUserId();
    await run(this.db.from(TABLE).upsert(
      {
        user_id: userId,
        disclaimer_accepted_at: acceptedAt,
        disclaimer_version: version,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    ));
    forgetSettingsMetadata();
  }
}
