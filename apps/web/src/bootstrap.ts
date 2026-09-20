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
import type { ProjectLwwInvalidator } from "@/lib/cache/project-lww-invalidator";

export type { AppContainer };
export type Container = AppContainer;

let container: AppContainer | null = null;
let containerCacheKey: string | null = null;
let projectLww: ProjectLwwInvalidator | null = null;
let disposeContainer: (() => void) | null = null;
let pending: Promise<AppContainer> | null = null;
let pendingKey: string | null = null;

function containerKey(): string {
  return `${readBackendConfig().provider}:${readStorageConfig().provider}`;
}

/**
 * Loads and caches the full AppContainer (dynamic import of create-app-container).
 * Call after privacy disclaimer acceptance (and from auth only if light path is insufficient).
 *
 * A container is rebuilt whenever the backend or storage provider changes — a
 * self-hoster switching from Supabase to their own Postgres, a desktop build
 * changing storage tier. The previous one is disposed first: it holds two dozen
 * repository-cache registrations, a session-reset hook and a joined private
 * realtime channel, and dropping the reference released none of them.
 */
export async function ensureContainer(): Promise<AppContainer> {
  const cacheKey = containerKey();
  if (container && containerCacheKey === cacheKey) return container;
  if (pending && pendingKey === cacheKey) return pending;

  pendingKey = cacheKey;
  pending = (async () => {
    const { createAppContainer } = await import("./create-app-container");
    const previous = disposeContainer;
    const created = await createAppContainer();
    container = created.container;
    projectLww = created.projectLww;
    disposeContainer = created.dispose;
    containerCacheKey = cacheKey;
    // After the new one is built, so a failure to build leaves the working
    // container in place rather than tearing down the app on a bad config.
    previous?.();
    return created.container;
  })();

  try {
    return await pending;
  } finally {
    if (pendingKey === cacheKey) {
      pending = null;
      pendingKey = null;
    }
  }
}

/** Sync accessor — throws if `ensureContainer()` has not completed for the current config. */
export function getContainer(): AppContainer {
  const cacheKey = containerKey();
  if (container && containerCacheKey === cacheKey) return container;
  throw new Error(
    "App container not ready. Call ensureContainer() after disclaimer acceptance.",
  );
}
