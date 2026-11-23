import type { SecretsStore } from "@/features/settings/infrastructure/parts";
import { isOfflineBuild } from "@/deployment/build-target";
import { DeviceSecretsStore } from "../device-secrets-store";
import { RefusingSecretsStore } from "./files/refusing-secrets-store";

/**
 * Where integration credentials live for the build this window came from.
 *
 * The question is **not** which mode the window is in, and answering that
 * instead is what broke saving credentials in the desktop app: a window signed
 * in to an account is still a window with no server when it was built as the
 * desktop export. `isOfflineBuild()` is the flag that actually answers it — the
 * same one that decides which modules the bundle contains — and
 * `build-target.ts` is the one place that reads it.
 *
 * The desktop export keeps keys in the OS keychain. The hosted web keeps none:
 * from 0.9.8 the old `/api/settings/credentials` route answers 410, so it uses
 * the browser workspace's store, which refuses a save and sends nothing.
 *
 * `hasServerRoutes` is a parameter rather than a second read of the flag so the
 * choice can be tested without rebuilding the app; every caller takes the
 * default.
 */
export function secretsStoreFor(hasServerRoutes: boolean = !isOfflineBuild()): SecretsStore {
  if (hasServerRoutes) return new RefusingSecretsStore();
  // Saves go to the OS keychain; until the 0.9.7 move runs, load still reads the old device row. (local/parts.ts)
  return new DeviceSecretsStore();
}