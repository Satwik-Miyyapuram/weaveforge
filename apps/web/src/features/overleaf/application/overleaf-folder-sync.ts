import { loadCore } from "@/lib/rust-core";
import {
  desktop,
  type DesktopBridge,
  type DesktopOverleafSync,
  type DesktopOverleafSyncRequest,
} from "@/lib/desktop/desktop-bridge";

/**
 * Overleaf projects synced into vault folders over Overleaf's git bridge
 * (Settings → Workspace folder). Desktop only: the shell runs git and holds
 * the token; this module stores what was typed and names the action. Files a
 * pull brings in reach the app the way any outside edit to the folder does.
 */

const NO_SHELL = "Syncing Overleaf projects needs the desktop app.";

type Shell = DesktopBridge & Required<Pick<DesktopBridge, "overleafSync">>;

function shell(): Shell | null {
  const bridge = desktop();
  return bridge && typeof bridge.overleafSync === "function" ? (bridge as Shell) : null;
}

export function overleafSyncAvailable(): boolean {
  return shell() !== null;
}

export function overleafSync(request: DesktopOverleafSyncRequest): Promise<DesktopOverleafSync> {
  const bridge = shell();
  if (!bridge) return Promise.reject(new Error(NO_SHELL));
  return bridge.overleafSync(request);
}

/** Store the Overleaf git token; the shell never hands it back. */
export async function saveOverleafToken(token: string): Promise<void> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  if (!token.trim()) throw new Error("Paste your Overleaf git token.");
  await bridge.writeSecret("overleaf-token", token.trim());
}

/** One line for the panel. */
export async function describeOverleafSync(reply: DesktopOverleafSync): Promise<string> {
  const core = await loadCore();
  if (reply.pull) return core.describePull(reply.pull);
  if (reply.push) return core.describePush(reply.push);
  return core.describeOverleafStatus(reply.status ?? null);
}
