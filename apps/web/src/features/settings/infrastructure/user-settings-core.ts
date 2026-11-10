import type { applyUserIntegrationFields } from "@weaveforge/wasm";
import type { UserSettings } from "@weaveforge/core";

/** The bindings `UserSettings` the wasm wrapper takes and returns. */
type CoreUserSettings = Parameters<typeof applyUserIntegrationFields>[0];

/** Bindings type f64 as number | null (NaN/Infinity serialise as null); the core only sends the domain's animationSpeed steps and finite motionScale. */
export function userSettingsFromCore(settings: CoreUserSettings): UserSettings {
  return settings as UserSettings;
}

/** Bindings type f64 as number | null (NaN/Infinity serialise as null); the core only sends the domain's animationSpeed steps and finite motionScale. */
export function userSettingsToCore(settings: UserSettings): CoreUserSettings {
  return settings as CoreUserSettings;
}
