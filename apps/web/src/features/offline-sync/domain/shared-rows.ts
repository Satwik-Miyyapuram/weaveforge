import type { SyncTransport } from "./parts";
import type { SqlRunner } from "./parts-2";

/**
 * The rows this device has shared out, as `sync_shared_rows` (0023) records them.
 *
 * While GitHub is connected, an edit to a shared row is owed to the server; an
 * edit to any other row stays on the device. The marker is therefore a copy of
 * the server's answer to "which shares does this account own?". Two things keep
 * it current: reconcile (at the start of each connected cycle, covering shares
 * made or revoked on other devices) and mark/unmark (at once, on this device's
 * own grant and revoke).
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

export class SharedRowMarks implements ShareMarks {
  constructor(private readonly sql: Pick<SqlRunner, "exec">) {}

  async mark(ref: ShareRef): Promise<void> {
    await this.sql.exec(
      `insert into sync_shared_rows (share_id, resource_type, resource_id)
       values ($1::uuid, $2::text, $3::uuid)
       on conflict (share_id) do update
         set resource_type = excluded.resource_type, resource_id = excluded.resource_id`,
      [ref.shareId, ref.resourceType, ref.resourceId],
    );
  }

  async unmark(shareId: string): Promise<void> {
    await this.sql.exec("delete from sync_shared_rows where share_id = $1::uuid", [shareId]);
  }

  /**
   * Make the markers exactly this set, in one statement: markers for shares
   * not in it are removed, the rest are written. An empty set clears them all.
   */
  async replace(refs: ShareRef[]): Promise<void> {
    await this.sql.exec(
      `with incoming as (
         select * from jsonb_to_recordset($1::jsonb)
           as r(share_id uuid, resource_type text, resource_id uuid)
       ),
       dropped as (
         delete from sync_shared_rows
          where share_id not in (select share_id from incoming)
         returning share_id
       )
       insert into sync_shared_rows (share_id, resource_type, resource_id)
       select share_id, resource_type, resource_id from incoming
       on conflict (share_id) do update
         set resource_type = excluded.resource_type, resource_id = excluded.resource_id`,
      [JSON.stringify(refs.map((r) => ({ share_id: r.shareId, resource_type: r.resourceType, resource_id: r.resourceId })))],
    );
  }
}

/**
 * Bring the markers into line with the server's list of this account's shares.
 *
 * Returns false and changes nothing when the list cannot be read: a failed read
 * is not proof that a share was revoked, so the existing markers are kept.
 */
export async function reconcileSharedRows(
  marks: SharedRowMarks,
  transport: SyncTransport,
  accountId: string,
): Promise<boolean> {
  let refs: ShareRef[] | null;
  try {
    refs = transport.ownShares ? await transport.ownShares(accountId) : null;
  } catch {
    return false;
  }
  if (refs === null) return false;
  await marks.replace(refs);
  return true;
}

/**
 * A share repository whose grants and revokes also set and clear the marker.
 *
 * The marker is written only after the server has taken the change, so a
 * failed grant or revoke leaves the marker as it was. A failed marker write
 * after a successful grant throws; the next reconcile sets it right.
 */
export function withShareMarks<T extends ShareWrites>(repo: T, marks: ShareMarks): T {
  return {
    ...repo,
    grant: async (input: Parameters<T["grant"]>[0]) => {
      const share = await repo.grant(input);
      await marks.mark({ shareId: share.id, resourceType: share.resourceType, resourceId: share.resourceId });
      return share;
    },
    revoke: async (id: string) => {
      await repo.revoke(id);
      await marks.unmark(id);
    },
  } as T;
}

/** The two share writes the marker follows. */
interface ShareWrites {
  grant(input: never): Promise<{ id: string; resourceType: string; resourceId: string | null }>;
  revoke(id: string): Promise<void>;
}
