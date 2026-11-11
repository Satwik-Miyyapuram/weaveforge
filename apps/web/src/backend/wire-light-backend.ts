import { SupabaseAuthService } from "@/features/auth/infrastructure/supabase-auth";
import {
  PostgrestSettingsRepository,
} from "@/features/settings/infrastructure/postgrest-settings-repository";
import { formatError } from "@/lib/format-error";
import { systemClock } from "@/lib/system";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type IAuthService,
  type ISelfProvisioner,
  type ManageSettingsUseCase,
  ManageSettingsUseCase as ManageSettingsUseCaseClass,
} from "@weaveforge/core";
import { type BackendConfig, readBackendConfig } from "./config";
import { isLocalMode, LocalAuthService } from "./providers/local/local-identity";
import { localBackendParts } from "./providers/local/wire-local-backend";
import { createDataClient } from "./providers/postgrest/client";
import { secretsStoreFor } from "./providers/secrets-store";
import { SupabaseSessionProvider } from "./providers/supabase-auth/session";

// --- postgrest-self-provisioner ---
/**
 * Users already known to be provisioned, for this tab's lifetime.
 *
 * Startup calls `ensureProvisioned()` on every boot, and once it has succeeded
 * the answer cannot change. Paying a round trip to re-learn it would undo the
 * point of running the call in parallel with the settings read.
 */
const provisioned = new Set<string>();

/**
 * Materialises the signed-in user's identity rows via a single RPC.
 *
 * `ensure_user_provisioned()` is `security definer` and derives everything from
 * `auth.uid()`, so this call carries no arguments — there is deliberately no
 * way for a client to ask for anyone else's rows.
 */
export class PostgrestSelfProvisioner implements ISelfProvisioner {
  constructor(private readonly db: SupabaseClient) {}

  async ensureProvisioned(force = false): Promise<void> {
    const { data } = await this.db.auth.getSession();
    const userId = data.session?.user.id;
    // No session means nothing to provision; the caller is on the login screen.
    if (!userId || (!force && provisioned.has(userId))) return;

    const { error } = await this.db.rpc("ensure_user_provisioned");
    if (error) throw new Error(`Could not set up your account: ${formatError(error)}`);
    provisioned.add(userId);
  }
}

/** Test seam — the memo outlives any one instance. */
export function resetSelfProvisioningMemoForTests(): void {
  provisioned.clear();
}

// --- wire-light-backend ---
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

  if (config.provider !== "postgrest") {
    throw new Error(
      "Light bootstrap requires NEXT_PUBLIC_BACKEND_PROVIDER=postgrest in the browser.",
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
  const db = createDataClient(url, anonKey, config.dataUrl);
  const session = new SupabaseSessionProvider(db);
  const auth = new SupabaseAuthService(db);
  // The same credentials store the full container will pick, and for the same
  // reason: this container is the one that handles the sign-in and the very
  // first settings write, so on a build with no routes of its own it must not
  // reach for `/api/settings/credentials` either.
  const settingsRepository = new PostgrestSettingsRepository(db, session, secretsStoreFor(db));
  const manageSettings = new ManageSettingsUseCaseClass({ repository: settingsRepository, clock: systemClock });
  return { auth, manageSettings, selfProvisioner: new PostgrestSelfProvisioner(db) };
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
    manageSettings: new ManageSettingsUseCaseClass({ repository: settingsRepository, clock: systemClock }),
    selfProvisioner: { ensureProvisioned: async () => {} },
  };
}
