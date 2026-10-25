import { logToApp } from "@/lib/error-report/app-log";
import { emptyIntegration, type Integration, type SyncProvider } from "../domain/integration";

/**
 * The project's connections, one per provider, or none with a reason.
 *
 * A failed read is shown rather than rendered as a list of unset connections,
 * which would invite the user to set up again what is already there.
 */
export async function loadIntegrations(
  get: (provider: SyncProvider) => Promise<Integration | null | undefined>,
  providers: readonly SyncProvider[],
): Promise<{ items: Record<string, Integration>; error: string | null }> {
  try {
    const loaded = await Promise.all(providers.map((provider) => get(provider)));
    const items = Object.fromEntries(
      providers.map((provider, i) => [provider, loaded[i] ?? emptyIntegration(provider)]),
    ) as Record<string, Integration>;
    return { items, error: null };
  } catch (err) {
    logToApp({
      level: "warn",
      source: "sync",
      message: "The project's connections could not load",
      detail: err instanceof Error ? err.message : String(err),
    });
    return { items: {}, error: "The connections could not load. Check the connection and reopen settings." };
  }
}
