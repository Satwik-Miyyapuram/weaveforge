import {
  CURRENT_DISCLAIMER_VERSION,
  type UserAppearance,
  type UserSettings,
} from "../domain/parts.js";
import type { ISettingsRepository, SettingsMetadata } from "../domain/parts.js";
import type { Clock } from "../../../shared/parts.js";
import { rust } from "../../../shared/rust.js";

export interface ManageSettingsDeps {
  repository: ISettingsRepository;
  clock: Clock;
}

/** Load and persist per-user integration settings (normalized on save). */
export class ManageSettingsUseCase {
  constructor(private readonly deps: ManageSettingsDeps) {}

  async get(): Promise<UserSettings> {
    return rust().hydrateUserSettings(await this.deps.repository.get() as never) as UserSettings;
  }

  async getMetadata(): Promise<SettingsMetadata> {
    return this.deps.repository.getMetadata();
  }

  async save(settings: UserSettings): Promise<void> {
    await this.deps.repository.save(rust().normalizeUserSettings(settings as never) as UserSettings);
  }

  async saveAppearance(appearance: UserAppearance): Promise<void> {
    const current = await this.get();
    await this.save({
      ...current,
      appearance: rust().normalizeAppearance({ ...current.appearance, ...appearance }) as UserAppearance | undefined,
    });
  }

  async acceptDisclaimer(): Promise<void> {
    await this.deps.repository.saveDisclaimer(this.deps.clock.nowIso(), CURRENT_DISCLAIMER_VERSION);
  }
}
