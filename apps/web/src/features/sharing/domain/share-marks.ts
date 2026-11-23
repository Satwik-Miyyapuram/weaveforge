import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";

/**
 * Keeps the share-owed marker in step with share grants and revokes. Moved here from the
 * removed offline-sync feature: the marker itself is now supplied by the caller, so this
 * module holds no local-database code.
 */

/** One share this account owns. `resourceId` null = every resource of that type. */
export interface ShareRef {
  shareId: string;
  resourceType: string;
  resourceId: string | null;
}

/** What the share writes need: the marker, set and cleared as the share changes. */
export interface ShareMarks {
  mark(ref: ShareRef): Promise<void>;
  unmark(shareId: string): Promise<void>;
}

/**
 * A share repository whose grants and revokes also set and clear the marker.
 *
 * The marker is written only after the server has taken the change, so a
 * failed grant or revoke leaves the marker as it was. The server's answer is
 * what the caller sees: a marker write that fails after the server took the
 * change is logged and swallowed, so the grant still resolves with its share.
 * The marker is then stale until the next connected cycle's reconcile fixes it.
 */
export function withShareMarks<T extends ShareWrites>(repo: T, marks: ShareMarks): T {
  const settleMarker = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch (err) {
      logToApp({
        level: "warn",
        source: "sync",
        message: "A shared-row marker write failed after the server took the share change",
        detail: describeRejection(err),
      });
    }
  };
  return {
    ...repo,
    grant: async (input: Parameters<T["grant"]>[0]) => {
      const share = await repo.grant(input);
      await settleMarker(() =>
        marks.mark({ shareId: share.id, resourceType: share.resourceType, resourceId: share.resourceId }),
      );
      return share;
    },
    revoke: async (id: string) => {
      await repo.revoke(id);
      await settleMarker(() => marks.unmark(id));
    },
  } as T;
}

/** The two share writes the marker follows. */
interface ShareWrites {
  grant(input: never): Promise<{ id: string; resourceType: string; resourceId: string | null }>;
  revoke(id: string): Promise<void>;
}
