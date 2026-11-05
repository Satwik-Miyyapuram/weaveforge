/**
 * Provider credential helpers (Rust `settings::integration_credentials`), re-exported from index.ts.
 * Keep the signatures of packages/core/src/features/settings/domain/user-integration-credentials.ts.
 * Types come from ./bindings.ts.
 */
import {
  getUserIntegrationField as rawGetUserIntegrationField,
  integrationsBagFromLegacy as rawIntegrationsBagFromLegacy,
  isUserIntegrationConnected as rawIsUserIntegrationConnected,
} from "../pkg/wf_wasm.js";
import type { CredentialSettings } from "./bindings.js";

const LEGACY_FIELDS = ["zoteroApiKey", "zoteroLibrary", "semanticScholarKey"];

/**
 * Plain JSON only, as the stored row is JSON. TS reads legacy columns only when they are
 * strings and treats null bag entries as missing, so drop those before Rust sees them.
 */
function plain(raw: unknown): unknown {
  const value: unknown = JSON.parse(JSON.stringify(raw) ?? "null");
  if (value === null || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  for (const key of LEGACY_FIELDS) {
    if (typeof row[key] !== "string") delete row[key];
  }
  const bags = row.integrations;
  if (bags === null) delete row.integrations;
  else if (typeof bags === "object" && !Array.isArray(bags)) {
    const byProvider = bags as Record<string, unknown>;
    for (const [provider, bag] of Object.entries(byProvider)) {
      if (bag === null) delete byProvider[provider];
      else if (typeof bag === "object" && !Array.isArray(bag)) {
        const fields = bag as Record<string, unknown>;
        for (const [field, v] of Object.entries(fields)) if (v === null) delete fields[field];
      }
    }
  }
  return row;
}

/** Read a provider field from the integrations bag or legacy flat columns. */
export function getUserIntegrationField(
  settings: CredentialSettings,
  providerId: string,
  fieldId: string,
): string | undefined {
  return (rawGetUserIntegrationField(plain(settings), providerId, fieldId) ?? undefined) as
    | string
    | undefined;
}

/** True when the provider has at least one non-empty credential field. */
export function isUserIntegrationConnected(
  settings: CredentialSettings,
  providerId: string,
  fieldIds: readonly string[],
): boolean {
  return rawIsUserIntegrationConnected(plain(settings), providerId, [...fieldIds]);
}

/** Build integrations bag from legacy flat columns (for reads after migration). */
export function integrationsBagFromLegacy(
  settings: CredentialSettings,
): Record<string, Record<string, string>> | undefined {
  return (rawIntegrationsBagFromLegacy(plain(settings)) ?? undefined) as
    | Record<string, Record<string, string>>
    | undefined;
}
