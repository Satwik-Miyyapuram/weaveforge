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
import { run } from "@/backend/providers/supabase/row-access";

/**
 * Supabase implementation of ISettingsRepository. One row per user; user_id is
 * filled by the column default auth.uid(). Non-secret fields are read/written
 * directly; integration credentials (Zotero / GitLab / Semantic Scholar) are
 * sealed with a server-held key via /api/settings/credentials (E2EE dropped).
 */

interface SettingsRow {
  user_id: string;
  zotero_library: string | null;
  disclaimer_accepted_at: string | null;
  disclaimer_version: number | null;
  appearance: Record<string, unknown> | null;
  ai_access: Record<string, unknown> | null;
}

type Secrets = Pick<UserSettings, "zoteroApiKey" | "semanticScholarKey" | "integrations">;

const TABLE = "user_settings";
const CREDENTIALS_ROUTE = "/api/settings/credentials";

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
 */
let metadataMemo: { at: number; value: Promise<SettingsMetadata> } | null = null;
let settingsMemo: { at: number; value: Promise<UserSettings> } | null = null;
const METADATA_MEMO_MS = 60_000;

function forgetSettingsMetadata(): void {
  metadataMemo = null;
  settingsMemo = null;
}

export class SupabaseSettingsRepository implements ISettingsRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
  ) {}

  private async authHeader(): Promise<Record<string, string>> {
    const { data } = await this.db.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async loadSecrets(): Promise<Secrets> {
    const res = await fetch(CREDENTIALS_ROUTE, { headers: await this.authHeader() });
    if (!res.ok) return {};
    return (await res.json()) as Secrets;
  }

  private async saveSecrets(secrets: Secrets): Promise<void> {
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

  /**
   * Full settings, memoized like the metadata read.
   *
   * Every integration credential lookup goes through here — Zotero, Semantic
   * Scholar, the bibliography sync, the settings screen itself — and each one
   * cost a `user_settings` row plus a `/api/settings/credentials` round trip.
   * Opening Settings made nine of the first and five of the second.
   */
  get(): Promise<UserSettings> {
    const now = Date.now();
    if (settingsMemo && now - settingsMemo.at < METADATA_MEMO_MS) return settingsMemo.value;
    const value = this.readSettings();
    settingsMemo = { at: now, value };
    void value.catch(() => {
      if (settingsMemo?.value === value) settingsMemo = null;
    });
    return value;
  }

  private async readSettings(): Promise<UserSettings> {
    const { data, error } = await this.db.from(TABLE).select("*").maybeSingle();
    if (error) throw error;
    if (!data) return { ...EMPTY_SETTINGS };
    const row = data as SettingsRow;
    const secrets = await this.loadSecrets();
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

  getMetadata(): Promise<SettingsMetadata> {
    const now = Date.now();
    if (metadataMemo && now - metadataMemo.at < METADATA_MEMO_MS) return metadataMemo.value;
    const value = this.readMetadata();
    metadataMemo = { at: now, value };
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
    // onto a minute-old copy could drop a field another tab just wrote.
    const existing = await this.readSettings();
    // Seal secrets server-side first (owns credentials_enc + clears plaintext).
    await this.saveSecrets({
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
