/**
 * Per-user settings domain model — pure, no I/O.
 *
 * Holds optional third-party credentials and preferences. There is exactly one
 * settings record per user (keyed by the authenticated user, not by an id), so
 * the repository exposes get/save rather than the generic CRUD contract.
 */

import { integrationsBagFromLegacy } from "./user-integration-credentials.js";
import { normalizeAppearance, type UserAppearance } from "./user-appearance.js";
import { normalizeAiAccessSettings, type AiAccessSettings } from "../../ai-assistant/index.js";
import { normalizeSearchSettings, type SearchSettings } from "../../../search/search-settings.js";

export type { UserAppearance, ControlSize } from "./user-appearance.js";
export { normalizeAppearance, parseUserAppearance } from "./user-appearance.js";

export interface UserSettings {
  /**
   * Provider-keyed credential bags (e.g. `{ zotero: { apiKey, library } }`).
   * Legacy flat columns remain in sync for existing DB rows.
   */
  integrations?: Record<string, Record<string, string>>;
  /** Zotero Web API key (zotero.org/settings/keys). */
  zoteroApiKey?: string;
  /** Zotero library path, e.g. "users/123456" or "groups/789". */
  zoteroLibrary?: string;
  /** Optional Semantic Scholar API key for higher rate limits. */
  semanticScholarKey?: string;
  /** ISO timestamp when the user accepted the org/privacy disclaimer. */
  disclaimerAcceptedAt?: string;
  /** Version of the disclaimer the user accepted (see CURRENT_DISCLAIMER_VERSION). */
  disclaimerVersion?: number;
  /** Light/dark mode and theme variant preferences. */
  appearance?: UserAppearance;
  /** Explicit, fail-closed access controls for the AI assistant. */
  aiAccess?: AiAccessSettings;
  /** Ranking preferences for workspace search. */
  search?: SearchSettings;
}

export const EMPTY_SETTINGS: UserSettings = {};

/** Merge integrations bag from legacy columns when loading from persistence. */
export function hydrateUserSettings(settings: UserSettings): UserSettings {
  const integrations = settings.integrations ?? integrationsBagFromLegacy(settings);
  if (!integrations) return settings;
  return { ...settings, integrations };
}

/** Trim strings and drop empties before persistence. */
export function normalizeUserSettings(settings: UserSettings): UserSettings {
  const out: UserSettings = {};
  const zoteroApiKey = settings.zoteroApiKey?.trim();
  const zoteroLibrary = settings.zoteroLibrary?.trim();
  const semanticScholarKey = settings.semanticScholarKey?.trim();
  if (zoteroApiKey) out.zoteroApiKey = zoteroApiKey;
  if (zoteroLibrary) out.zoteroLibrary = zoteroLibrary;
  if (semanticScholarKey) out.semanticScholarKey = semanticScholarKey;
  if (settings.disclaimerAcceptedAt) out.disclaimerAcceptedAt = settings.disclaimerAcceptedAt;
  if (
    typeof settings.disclaimerVersion === "number" &&
    Number.isInteger(settings.disclaimerVersion) &&
    settings.disclaimerVersion > 0
  ) {
    out.disclaimerVersion = settings.disclaimerVersion;
  }

  const appearance = normalizeAppearance(settings.appearance);
  if (appearance) out.appearance = appearance;

  if (settings.aiAccess) out.aiAccess = normalizeAiAccessSettings(settings.aiAccess);

  const search = normalizeSearchSettings(settings.search);
  if (search) out.search = search;

  const integrations = settings.integrations ?? integrationsBagFromLegacy(settings);
  if (integrations) {
    const cleaned: Record<string, Record<string, string>> = {};
    for (const [providerId, bag] of Object.entries(integrations)) {
      const fields: Record<string, string> = {};
      for (const [fieldId, value] of Object.entries(bag)) {
        const trimmed = value?.trim();
        if (trimmed) fields[fieldId] = trimmed;
      }
      if (Object.keys(fields).length) cleaned[providerId] = fields;
    }
    if (Object.keys(cleaned).length) out.integrations = cleaned;
  }
  return out;
}
