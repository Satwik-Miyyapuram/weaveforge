import { checkGitRemoteUrl, describePull, describePush } from "@weaveforge/core";
import {
  desktop,
  type DesktopBridge,
  type DesktopVaultSync,
  type DesktopVaultSyncAction,
} from "@/lib/desktop/desktop-bridge";

/**
 * Pushing and pulling the workspace folder to a git remote (Settings → Workspace folder).
 *
 * Desktop only: the shell runs git, reads the URL and token from its own stores,
 * and never hands the token back. This module only stores what was typed and
 * names the action. Files a pull brings in reach the app the way any outside
 * edit to the folder does: the folder watcher reports them for import.
 */

const NO_SHELL = "Syncing with a git remote needs the desktop app.";

function shell(): (DesktopBridge & Required<Pick<DesktopBridge, "vaultSync">>) | null {
  const bridge = desktop();
  return bridge && typeof bridge.vaultSync === "function"
    ? (bridge as DesktopBridge & Required<Pick<DesktopBridge, "vaultSync">>)
    : null;
}

export function remoteSyncAvailable(): boolean {
  return shell() !== null;
}

/**
 * Store the remote's URL, and the token when one was typed. An empty token
 * keeps the stored one; `null` forgets it. A URL that is not plain https is
 * refused before anything is stored. Answers the URL as stored.
 */
export async function saveRemoteSyncSettings(input: { url: string; token: string | null }): Promise<string> {
  const url = checkGitRemoteUrl(input.url);
  if (!url.ok) throw new Error(url.reason);
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  await bridge.writePreference("vault-git-remote", url.url);
  if (input.token === null) await bridge.clearSecret("git-sync-token");
  else if (input.token.trim()) await bridge.writeSecret("git-sync-token", input.token.trim());
  return url.url;
}

/** Forget the stored token; the URL, typed or stored, plays no part. */
export async function forgetRemoteToken(): Promise<void> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  await bridge.clearSecret("git-sync-token");
}

/**
 * Forget the remote: its URL and its token. The folder and its history stay
 * as they are; only syncing stops until a URL is saved again.
 */
export async function disconnectRemote(): Promise<void> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  await bridge.writePreference("vault-git-remote", null);
  await bridge.clearSecret("git-sync-token");
}

export function folderRemoteSync(action: DesktopVaultSyncAction): Promise<DesktopVaultSync> {
  const bridge = shell();
  if (!bridge) return Promise.reject(new Error(NO_SHELL));
  return bridge.vaultSync(action);
}

/** One line for the panel. */
export function describeRemoteSync(reply: DesktopVaultSync): string {
  if (reply.pull) return describePull(reply.pull);
  if (reply.push) return describePush(reply.push);
  const status = reply.status;
  if (!status) return "";
  if (!status.url) return "Not connected yet.";
  if (status.ahead === 0 && status.behind === 0) return `In step with the remote on ${status.branch}.`;
  return `${status.ahead} commit${status.ahead === 1 ? "" : "s"} to push, ${status.behind} to pull on ${status.branch}.`;
}
