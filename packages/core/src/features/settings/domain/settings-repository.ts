/**
 * Repository contract for per-user settings (DIP). One record per user, so the
 * interface is get/save rather than id-keyed CRUD.
 */

import type { UserSettings } from "./user-settings.js";

export type SettingsMetadata = Pick<
  UserSettings,
  "disclaimerAcceptedAt" | "disclaimerVersion" | "appearance"
>;

export interface ISettingsRepository {
  /** The current user's settings; empty object if none saved yet. */
  get(): Promise<UserSettings>;
  /** Read non-secret settings that are safe before encryption unlock. */
  getMetadata(): Promise<SettingsMetadata>;
  /** Persist the current user's settings (full replace). */
  save(settings: UserSettings): Promise<void>;
  /** Persist only legal/disclaimer metadata before encryption is unlocked. */
  saveDisclaimer(acceptedAt: string, version: number): Promise<void>;
}
