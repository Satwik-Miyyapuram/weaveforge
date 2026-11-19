/** The open workspace's id and tier, read by the shell from `.weaveforge/settings.json`. */
export interface DesktopOpenTier {
  workspaceId: string;
  /** "local", "local-web" or "sharing". */
  tier: string;
  /** Bumped on every tier change. */
  tierEpoch: number;
  tierAccount: string | null;
  serverHint: string | null;
}
