/**
 * Which row kinds server row sync may carry, given whether GitHub sync is on.
 *
 * With GitHub connected, the vault in git is the source of truth for the
 * workspace, so the server carries only what has to be shared between people:
 * shared items, their share links, comments, and the live-session relay.
 * Without GitHub, every kind travels as it always has.
 */
export const SHARED_ROW_KINDS: readonly string[] = [
  "shares",
  "share_links",
  "comments",
  "ai_mcp_relay_requests",
];

export function shouldSyncRowKind(kind: string, githubConnected: boolean): boolean {
  if (!githubConnected) return true;
  return SHARED_ROW_KINDS.includes(kind);
}
