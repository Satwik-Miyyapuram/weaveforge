/**
 * Per-project integration config (git sync + notifications). Web-side type —
 * the sync layer is infrastructure, so this lives outside @thesis/core.
 *
 * Field semantics per provider: see `integration-fields.ts` (e.g. Mattermost
 * stores server URL in `repo` and channel id in `branch`).
 */
export type SyncProvider = "github" | "gitlab" | "mattermost";

export interface Integration {
  provider: SyncProvider;
  enabled: boolean;
  /** GitHub/GitLab: API token. Mattermost: bot token. */
  token?: string;
  /** GitHub: "owner/name". GitLab: project path or id. Mattermost: server URL. */
  repo?: string;
  /** GitHub/GitLab: branch. Mattermost: channel id. */
  branch: string;
}

export function emptyIntegration(provider: SyncProvider): Integration {
  return { provider, enabled: false, branch: provider === "mattermost" ? "" : "main" };
}
