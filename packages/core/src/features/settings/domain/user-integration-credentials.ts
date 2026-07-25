import type { UserSettings } from "./user-settings.js";

/** Provider-keyed credential bags stored on {@link UserSettings}. */
export type IntegrationCredentialBag = Record<string, string>;

const LEGACY_FIELD_MAP: Record<string, Record<string, "zoteroApiKey" | "zoteroLibrary" | "semanticScholarKey">> = {
  zotero: { apiKey: "zoteroApiKey", library: "zoteroLibrary" },
  "semantic-scholar": { apiKey: "semanticScholarKey" },
};

/** Read a provider field from the integrations bag or legacy flat columns. */
export function getUserIntegrationField(
  settings: UserSettings,
  providerId: string,
  fieldId: string,
): string | undefined {
  const fromBag = settings.integrations?.[providerId]?.[fieldId]?.trim();
  if (fromBag) return fromBag;
  const legacyKey = LEGACY_FIELD_MAP[providerId]?.[fieldId];
  if (!legacyKey) return undefined;
  const legacy = settings[legacyKey];
  return typeof legacy === "string" && legacy.trim() ? legacy.trim() : undefined;
}

/** True when the provider has at least one non-empty credential field. */
export function isUserIntegrationConnected(
  settings: UserSettings,
  providerId: string,
  fieldIds: readonly string[],
): boolean {
  return fieldIds.some((id) => !!getUserIntegrationField(settings, providerId, id));
}

/** Merge provider fields into settings (updates bag + legacy keys). */
export function applyUserIntegrationFields(
  settings: UserSettings,
  providerId: string,
  fields: IntegrationCredentialBag,
): UserSettings {
  const next: UserSettings = { ...settings };
  const bag = { ...(next.integrations?.[providerId] ?? {}) };
  for (const [fieldId, value] of Object.entries(fields)) {
    bag[fieldId] = value;
    const legacyKey = LEGACY_FIELD_MAP[providerId]?.[fieldId];
    if (legacyKey) next[legacyKey] = value;
  }
  next.integrations = { ...next.integrations, [providerId]: bag };
  return next;
}

/** Build integrations bag from legacy flat columns (for reads after migration). */
export function integrationsBagFromLegacy(settings: UserSettings): UserSettings["integrations"] {
  const out: Record<string, IntegrationCredentialBag> = {};
  for (const [providerId, fields] of Object.entries(LEGACY_FIELD_MAP)) {
    const bag: IntegrationCredentialBag = {};
    for (const [fieldId, legacyKey] of Object.entries(fields)) {
      const v = settings[legacyKey];
      if (typeof v === "string" && v.trim()) bag[fieldId] = v.trim();
    }
    if (Object.keys(bag).length) out[providerId] = bag;
  }
  return Object.keys(out).length ? out : undefined;
}
