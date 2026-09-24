import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RouteSecretsStore,
  type SecretsStore,
} from "@/features/settings/infrastructure/supabase-settings-repository";
import { isOfflineBuild } from "@/deployment/build-target";
import { DeviceSecretsStore } from "./local/device-secrets-store";

/**
 * Where integration credentials live for the build this window came from.
 *
 * The question is **not** which mode the window is in, and answering that
 * instead is what broke saving credentials in the desktop app. A window signed
 * in to an account is still a window with no server when it was built as the
 * desktop export, and that build holds `src/app/api/` aside
 * (`apps/desktop/scripts/build-web.mjs`): the credentials route is not in the
 * bundle at all, the fetch reaches the `app://` file handler, and the 404 with
 * an empty body surfaced as the generic "Failed to save integration
 * credentials." while writing nothing at all.
 *
 * `isOfflineBuild()` is the flag that actually answers it — the same one that
 * decides which modules the bundle contains — and `build-target.ts` is the one
 * place that reads it.
 *
 * `hasServerRoutes` is a parameter rather than a second read of the flag so the
 * choice can be tested without rebuilding the app; every caller takes the
 * default.
 */
export function secretsStoreFor(
  db: SupabaseClient,
  hasServerRoutes: boolean = !isOfflineBuild(),
): SecretsStore {
  if (hasServerRoutes) return new RouteSecretsStore(db);
  // The shell applies `supabase/migrations-local` on every launch, so this table
  // is there whether or not the window is signed in.
  return new DeviceSecretsStore();
}
