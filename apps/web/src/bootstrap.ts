/**
 * Thin composition-root entry.
 *
 * Login / privacy disclaimer use `@/light-bootstrap` (auth + settings only).
 * After disclaimer acceptance, call `ensureContainer()` once — it dynamically
 * imports the heavy create path. Sync `getContainer()` is safe only after that.
 */

import type { AppContainer } from "@/container/facades";
import { readBackendConfig } from "@/backend/config";
import { readStorageConfig } from "@/storage/config";
import { createRebuildSlot } from "@/container/rebuild-slot";

export type { AppContainer };
export type Container = AppContainer;

function containerKey(): string {
  return `${readBackendConfig().provider}:${readStorageConfig().provider}`;
}

const slot = createRebuildSlot(async () => {
  const { createAppContainer } = await import("./create-app-container");
  return createAppContainer();
});

/**
 * Loads and caches the full AppContainer (dynamic import of create-app-container).
 * Call after privacy disclaimer acceptance (and from auth only if light path is insufficient).
 *
 * A container is rebuilt whenever the backend or storage provider changes — a
 * self-hoster switching from PostgREST to their own Postgres, a desktop build
 * changing storage tier. The previous one is disposed once the new one is
 * built: it holds two dozen repository-cache registrations, a session-reset
 * hook and a joined private realtime channel, and dropping the reference
 * released none of them. Overlapping builds leave only the newest installed.
 */
export async function ensureContainer(): Promise<AppContainer> {
  return (await slot.ensure(containerKey())).container;
}

/** Sync accessor — throws if `ensureContainer()` has not completed for the current config. */
export function getContainer(): AppContainer {
  const built = slot.get(containerKey());
  if (built) return built.container;
  throw new Error(
    "App container not ready. Call ensureContainer() after disclaimer acceptance.",
  );
}
