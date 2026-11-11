/**
 * User settings row helpers (Rust `settings::user_settings`), re-exported from index.ts.
 * Keep the signatures of packages/core/src/features/settings/domain/user-settings.ts and
 * applyUserIntegrationFields from user-integration-credentials.ts. Types come from ./bindings.ts.
 */
import {
  applyUserIntegrationFields as rawApplyUserIntegrationFields,
  hydrateUserSettings as rawHydrateUserSettings,
  needsDisclaimerAcceptance as rawNeedsDisclaimerAcceptance,
  normalizeUserSettings as rawNormalizeUserSettings,
} from "../pkg/wf_wasm.js";
import type { UserSettings } from "./bindings.js";

export const EMPTY_SETTINGS: UserSettings = {};

/** Plain JSON only, as the stored row is JSON. */
function plain(raw: unknown): unknown {
  return JSON.parse(JSON.stringify(raw) ?? "null");
}

/** Merge integrations bag from legacy columns when loading from persistence. */
export function hydrateUserSettings(settings: UserSettings): UserSettings {
  return rawHydrateUserSettings(plain(settings)) as UserSettings;
}

/** Trim strings and drop empties before persistence. */
export function normalizeUserSettings(settings: UserSettings): UserSettings {
  return rawNormalizeUserSettings(plain(settings)) as UserSettings;
}

/** Whether the user must accept the disclaimer again (no acceptance, or an older version). */
export function needsDisclaimerAcceptance(
  settings: Pick<UserSettings, "disclaimerAcceptedAt" | "disclaimerVersion">,
): boolean {
  return rawNeedsDisclaimerAcceptance(plain(settings));
}

/** Set a provider's credential fields in its bag and the matching legacy columns. */
export function applyUserIntegrationFields(
  settings: UserSettings,
  providerId: string,
  fields: Record<string, string>,
): UserSettings {
  return rawApplyUserIntegrationFields(plain(settings), providerId, plain(fields)) as UserSettings;
}
