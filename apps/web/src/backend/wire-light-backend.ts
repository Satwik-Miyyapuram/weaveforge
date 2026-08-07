import type { IAuthService, ManageSettingsUseCase } from "@weaveforge/core";
import { ManageSettingsUseCase as ManageSettingsUseCaseClass } from "@weaveforge/core";
import type { BackendConfig } from "./config";
import { readBackendConfig } from "./config";
import { createSupabaseClient } from "./providers/supabase/client";
import { SupabaseSessionProvider } from "./providers/supabase/session";
import { SupabaseAuthService } from "@/features/auth/infrastructure/supabase-auth";
import { SupabaseSettingsRepository } from "@/features/settings/infrastructure/supabase-settings-repository";

/**
 * Pre-disclaimer backend: auth + settings only.
 * Avoids pulling repositories, integrations, AI, and collab into the login/privacy chunk.
 */
export interface LightBackend {
  readonly auth: IAuthService;
  readonly manageSettings: ManageSettingsUseCase;
}

export function wireLightBackend(config: BackendConfig = readBackendConfig()): LightBackend {
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

  const db = createSupabaseClient(url, anonKey);
  const session = new SupabaseSessionProvider(db);
  const auth = new SupabaseAuthService(db);
  const settingsRepository = new SupabaseSettingsRepository(db, session);
  const manageSettings = new ManageSettingsUseCaseClass({ repository: settingsRepository });
  return { auth, manageSettings };
}
