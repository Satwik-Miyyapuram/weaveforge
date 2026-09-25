import type { ProjectContext } from "@/lib/project-context";
import type { ResourceType } from "@/lib/cache/cache-invalidation-map";
import {
  clearProjectCacheHooks,
  configureProjectCacheHooks,
  ProjectLwwInvalidator,
  setActiveProjectIdForCache,
} from "@/lib/cache/project-lww-invalidator";
import { registerSessionReset } from "@/lib/cache/clear-session-caches";

/**
 * Everything a container registers, and the way it takes it all back.
 *
 * This is a piece of the composition root with its own subject, pulled out for
 * the same reason the gate insists on: the root had grown past the size where a
 * reader can find the part they came for, and this is a self-contained part.
 *
 * The subject is ownership. A container registers about two dozen repository
 * caches, a session-reset hook and a joined realtime channel, and until this
 * existed none of them could be released — which is invisible until something
 * rebuilds the container, and `bootstrap.ts` rebuilds it whenever the backend or
 * storage provider changes. So each generation left its registrations behind,
 * every generation's reset hook ran on one sign-out, and each left a private
 * channel open. The hooks are module-level single slots as well, so a container
 * that goes without clearing them leaves the *next* container's writes being
 * reported to its invalidator.
 */
export interface ContainerLifecycle {
  /** The peer-invalidation channel and local invalidation entry point. */
  readonly projectLww: ProjectLwwInvalidator;
  /**
   * Install the write hook and start collecting disposers.
   *
   * Must run before the backend is wired: registering the repository caches is
   * what fills the list, and `wireBackend` is what registers them.
   */
  installHooks(onWrite: (resourceType?: ResourceType) => void): void;
  /**
   * Register the sign-out reset.
   *
   * Called once everything the reset reaches exists — it closes over the
   * workspace facade, and registering it before that was a `const` used above
   * its declaration.
   */
  registerReset(reset: () => void): void;
  /** Release every registration, the reset hook, the channel, and the hooks. */
  dispose(): void;
}

export function createContainerLifecycle(
  projectContext: ProjectContext,
  pid: () => string | null,
): ContainerLifecycle {
  const projectLww = new ProjectLwwInvalidator();
  setActiveProjectIdForCache(pid);
  const disposers: Array<() => void> = [];

  return {
    projectLww,

    installHooks(onWrite) {
      configureProjectCacheHooks({
        onWrite,
        // The cache used to be handed to the invalidator, which held it in a Set
        // nothing ever read. What matters is the way back out.
        register: (_cache, dispose) => disposers.push(dispose),
      });
    },

    registerReset(reset) {
      disposers.push(registerSessionReset(reset));
    },

    dispose() {
      clearProjectCacheHooks();
      for (const release of disposers) release();
      disposers.length = 0;
      projectLww.dispose();
      projectContext.projectId = null;
    },
  };
}
