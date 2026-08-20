import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollabSnapshotHelpers, CollabSession } from "@/features/collab/application/collab-session";
import type { ICrdtUpdateStore, ICurrentUserProvider } from "@weaveforge/core";

export class CollabFacade {
  constructor(
    private readonly inner: {
      crdtStore: ICrdtUpdateStore;
      crdtSnapshotStore: import("@/features/collab/infrastructure/crdt-snapshot-store").CrdtSnapshotStore;
      compactCrdtLog: import("@weaveforge/core").CompactCrdtLogUseCase;
      db: SupabaseClient;
      session: ICurrentUserProvider;
      projectId: () => string | null;
    },
  ) {}

  enabled() {
    return true;
  }

  collabDeps() {
    return this.inner;
  }

  /**
   * One session object per resource, reused.
   *
   * The editor keys its Yjs/CodeMirror effect on this object, so a fresh one
   * per call meant a new identity on every render: the editor tore itself down
   * and rebuilt, each teardown flushed a save, each save re-rendered the host,
   * and round it went. The call site was fixed with a `useMemo`, but the
   * identity is a property of the session, not of one caller remembering to
   * memoise — so it is cached here too.
   */
  private readonly sessionCache = new Map<string, CollabSession>();

  collabSession(resourceType: string, resourceId: string): CollabSession {
    const cacheKey = `${resourceType}\u0000${resourceId}`;
    const cached = this.sessionCache.get(cacheKey);
    if (cached) return cached;

    const snapshot = this.snapshotHelpers(resourceType, resourceId);
    const session: CollabSession = {
      crdtStore: this.inner.crdtStore,
      db: this.inner.db,
      projectId: this.inner.projectId,
      compactCrdtLog: snapshot.compactCrdtLog,
      getSnapshotUpto: snapshot.getSnapshotUpto,
      setSnapshotUpto: snapshot.setSnapshotUpto,
    };
    this.sessionCache.set(cacheKey, session);
    return session;
  }

  snapshotHelpers(resourceType: string, resourceId: string): CollabSnapshotHelpers {
    const store = this.inner.crdtSnapshotStore;
    return {
      getSnapshotUpto: () => store.getSnapshotUpto(resourceType, resourceId),
      setSnapshotUpto: (uptoId: number) => store.setSnapshotUpto(resourceType, resourceId, uptoId),
      compactCrdtLog: this.inner.compactCrdtLog,
    };
  }

  requireUserId() {
    return this.inner.session.requireUserId();
  }
}
