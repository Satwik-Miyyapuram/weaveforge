import type { UserSettings } from "./user-settings.js";

/** Bump when disclaimer copy changes materially — users must re-accept. */
export const CURRENT_DISCLAIMER_VERSION = 5;

export function needsDisclaimerAcceptance(settings: UserSettings): boolean {
  if (!settings.disclaimerAcceptedAt) return true;
  return (settings.disclaimerVersion ?? 1) < CURRENT_DISCLAIMER_VERSION;
}
