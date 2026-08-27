import type { IAuthService, ISelfProvisioner, ManageSettingsUseCase } from "@weaveforge/core";
import { ManageSettingsUseCase as ManageSettingsUseCaseClass } from "@weaveforge/core";
import type { BackendConfig } from "./config";
import { readBackendConfig } from "./config";
import { createSupabaseClient } from "./providers/supabase/client";
import { SupabaseSessionProvider } from "./providers/supabase/session";
import { SupabaseAuthService } from "@/features/auth/infrastructure/supabase-auth";
import { SupabaseSettingsRepository } from "@/features/settings/infrastructure/supabase-settings-repository";
import { SupabaseSelfProvisioner } from "@/features/org/infrastructure/supabase-self-provisioner";
import { isLocalMode, LocalAuthService } from "./providers/local/local-identity";
import { localBackendParts } from "./providers/local/wire-local-backend";

/**
 * Pre-disclaimer backend: auth + settings only.
 * Avoids pulling repositories, integrations, AI, and collab into the login/privacy chunk.
 */
export interface LightBackend {
  readonly auth: IAuthService;
  readonly manageSettings: ManageSettingsUseCase;
  /** Pre-disclaimer because the disclaimer itself is the first write. */
  readonly selfProvisioner: ISelfProvisioner;
}

export function wireLightBackend(config: BackendConfig = readBackendConfig()): LightBackend {
  // The same choice the full container makes, made earlier: this runs first,
  // and a window working on this computer must not be asked to sign in.
  if (isLocalMode()) return wireLocalLightBackend();

  if (config.provider !== "supabase") {
    throw new Error(
      "Light bootstrap requires NEXT_PUBLIC_BACKEND_PROVIDER=supabase in the browser.",
    );
  }
  const url = config.supabaseUrl;
  const anonKey = config.supabaseAnonKey;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase backend requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  // `config.dataUrl` explicitly: this runs before the full container, so the
  // client it builds is the one the whole session gets.
  const db = createSupabaseClient(url, anonKey, config.dataUrl);
  const session = new SupabaseSessionProvider(db);
  const auth = new SupabaseAuthService(db);
  const settingsRepository = new SupabaseSettingsRepository(db, session);
  const manageSettings = new ManageSettingsUseCaseClass({ repository: settingsRepository });
  return { auth, manageSettings, selfProvisioner: new SupabaseSelfProvisioner(db) };
}

/**
 * Auth and settings for a copy with no account.
 *
 * Provisioning is a no-op rather than an error: the local user's rows are
 * created by the shell when it opens the database, so there is nothing left
 * for the app to ask for.
 */
function wireLocalLightBackend(): LightBackend {
  const { settingsRepository } = localBackendParts();
  return {
    auth: new LocalAuthService(),
    manageSettings: new ManageSettingsUseCaseClass({ repository: settingsRepository }),
    selfProvisioner: { ensureProvisioned: async () => {} },
  };
}
