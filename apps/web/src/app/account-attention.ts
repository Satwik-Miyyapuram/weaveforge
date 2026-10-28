import type { InboxLink } from "./inbox-links";

export interface AccountAttentionInput {
  /** Sync conflicts waiting on this device. */
  conflicts: number;
  inbox: InboxLink[];
  /** The menu already lists every Inbox row (phone, project picker). */
  inboxInMenu: boolean;
}

/**
 * What needs the person, for the account icon's count and the top of its menu.
 * Only rows with a count are attention: a synced device or an empty Inbox
 * puts nothing on the icon.
 */
export function accountAttention(input: AccountAttentionInput): { rows: InboxLink[]; total: number } {
  const waiting = input.inbox.filter((row) => (row.badge ?? 0) > 0);
  const conflictRow: InboxLink[] =
    input.conflicts > 0
      ? [{ key: "sync-conflicts", label: "Sync conflicts", path: "/settings#settings-sync", icon: "sync", badge: input.conflicts }]
      : [];
  const total = input.conflicts + waiting.reduce((n, row) => n + (row.badge ?? 0), 0);
  return { rows: [...conflictRow, ...(input.inboxInMenu ? [] : waiting)], total };
}
