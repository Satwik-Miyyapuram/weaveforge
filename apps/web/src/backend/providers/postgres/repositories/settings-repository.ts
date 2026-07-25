import {
  EMPTY_SETTINGS,
  hydrateUserSettings,
  parseUserAppearance,
  normalizeAiAccessSettings,
  type SettingsMetadata,
  type ISettingsRepository,
  type UserSettings,
} from "@thesis/core";
import type { ICurrentUserProvider } from "@thesis/core";
import type { PgRunner } from "../pg-runner";

interface SettingsRow {
  user_id: string;
  zotero_api_key: string | null;
  zotero_library: string | null;
  semantic_scholar_key: string | null;
  integrations: Record<string, Record<string, string>> | null;
  disclaimer_accepted_at: string | null;
  disclaimer_version: number | null;
  appearance: Record<string, unknown> | null;
  ai_access: Record<string, unknown> | null;
}

export class PostgresSettingsRepository implements ISettingsRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly session: ICurrentUserProvider,
  ) {}

  async get(): Promise<UserSettings> {
    const userId = await this.session.requireUserId();
    const row = await this.pg.queryOne<SettingsRow>(
      "select * from user_settings where user_id = $1",
      [userId],
    );
    if (!row) return { ...EMPTY_SETTINGS };
    return hydrateUserSettings({
      zoteroApiKey: row.zotero_api_key ?? undefined,
      zoteroLibrary: row.zotero_library ?? undefined,
      semanticScholarKey: row.semantic_scholar_key ?? undefined,
      integrations: row.integrations ?? undefined,
      disclaimerAcceptedAt: row.disclaimer_accepted_at ?? undefined,
      disclaimerVersion: row.disclaimer_version ?? undefined,
      appearance: parseUserAppearance(row.appearance) ?? undefined,
      aiAccess: row.ai_access ? normalizeAiAccessSettings(row.ai_access as never) : undefined,
    });
  }

  async getMetadata(): Promise<SettingsMetadata> {
    const userId = await this.session.requireUserId();
    const row = await this.pg.queryOne<Pick<SettingsRow, "disclaimer_accepted_at" | "disclaimer_version" | "appearance">>(
      "select disclaimer_accepted_at, disclaimer_version, appearance from user_settings where user_id = $1",
      [userId],
    );
    if (!row) return {};
    return {
      disclaimerAcceptedAt: row.disclaimer_accepted_at ?? undefined,
      disclaimerVersion: row.disclaimer_version ?? undefined,
      appearance: parseUserAppearance(row.appearance) ?? undefined,
    };
  }

  async save(settings: UserSettings): Promise<void> {
    if (hasReusableCredential(settings)) {
      throw new Error(
        "The external Postgres backend cannot store integration credentials securely. Use the E2EE browser-backed settings store.",
      );
    }
    const userId = await this.session.requireUserId();
    const existing = await this.get();
    await this.pg.exec(
      `insert into user_settings (user_id, zotero_api_key, zotero_library, semantic_scholar_key, integrations, disclaimer_accepted_at, disclaimer_version, appearance, ai_access, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (user_id) do update set
         zotero_api_key = excluded.zotero_api_key,
         zotero_library = excluded.zotero_library,
         semantic_scholar_key = excluded.semantic_scholar_key,
         integrations = excluded.integrations,
         disclaimer_accepted_at = coalesce(excluded.disclaimer_accepted_at, user_settings.disclaimer_accepted_at),
         disclaimer_version = coalesce(excluded.disclaimer_version, user_settings.disclaimer_version),
         appearance = coalesce(excluded.appearance, user_settings.appearance),
         ai_access = coalesce(excluded.ai_access, user_settings.ai_access),
         updated_at = excluded.updated_at`,
      [
        userId,
        settings.zoteroApiKey ?? null,
        settings.zoteroLibrary ?? null,
        settings.semanticScholarKey ?? null,
        settings.integrations ?? null,
        settings.disclaimerAcceptedAt ?? null,
        settings.disclaimerVersion ?? existing.disclaimerVersion ?? null,
        settings.appearance ?? existing.appearance ?? null,
        settings.aiAccess ?? existing.aiAccess ?? null,
        new Date().toISOString(),
      ],
    );
  }

  async saveDisclaimer(acceptedAt: string, version: number): Promise<void> {
    const userId = await this.session.requireUserId();
    await this.pg.exec(
      `insert into user_settings (user_id, disclaimer_accepted_at, disclaimer_version, updated_at)
       values ($1, $2, $3, $4)
       on conflict (user_id) do update set
         disclaimer_accepted_at = excluded.disclaimer_accepted_at,
         disclaimer_version = excluded.disclaimer_version,
         updated_at = excluded.updated_at`,
      [userId, acceptedAt, version, new Date().toISOString()],
    );
  }
}

function hasReusableCredential(settings: UserSettings): boolean {
  return Boolean(
    settings.zoteroApiKey?.trim() ||
    settings.semanticScholarKey?.trim() ||
    Object.values(settings.integrations ?? {}).some((fields) => Object.values(fields).some((value) => value.trim())),
  );
}
