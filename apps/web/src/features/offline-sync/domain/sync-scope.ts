import type { RemoteChange } from "./parts";

/**
 * Which rows server row sync carries, given whether GitHub sync is on.
 *
 * With GitHub connected, the vault in git owns this device's workspace. Server
 * sync then carries only what other people can see: rows that someone else
 * owns and shared with this device (pulled), and rows this device owns that
 * are shared out (pushed). Ownership decides, not the table name, because the
 * change feed only holds the workspace tables.
 */

/** Sharing's own tables. They are never in the change feed, so they are pushed on their own. */
export const SHARING_KINDS: readonly string[] = ["shares", "share_links", "comments", "ai_mcp_relay_requests"];

/** The sharing resource type a row of each table is shared as. */
export const SHARE_RESOURCE_TYPE: Readonly<Record<string, string>> = {
  milestones: "milestone",
  experiments: "experiment",
  report_sections: "report_section",
  reading_lists: "reading_list",
  papers: "paper",
};

/** The owner of a feed row, or null when the row does not say. */
export function ownerOf(row: Record<string, unknown>): string | null {
  const owner = row.user_id ?? row.owner_id;
  return typeof owner === "string" && owner.length > 0 ? owner.toLowerCase() : null;
}

/**
 * Whether a pulled change is written to this device.
 *
 * Without GitHub every change is written. With GitHub, a live row is written
 * only when someone else owns it (it was shared with this device); a row with
 * no readable owner is refused, so an unknown row cannot slip into the
 * workspace. Deletes always pass: the local copy of a deleted row goes.
 */
export function shouldApplyPulled(change: RemoteChange, localUserId: string, githubConnected: boolean): boolean {
  if (!githubConnected) return true;
  if (change.deletedAt !== null) return true;
  const owner = ownerOf(change.row);
  // Without a known local user there is no way to tell shared-in from owned.
  return localUserId !== "" && owner !== null && owner !== localUserId.toLowerCase();
}
