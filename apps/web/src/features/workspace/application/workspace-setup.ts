import type { DesktopWorkspaceSetup } from "@/lib/desktop/desktop-bridge";
import { desktop } from "@/lib/desktop/desktop-bridge";

/** The one shell call the first-open question needs. */
export interface WorkspaceSetupSource {
  workspaceSetup?(): Promise<DesktopWorkspaceSetup>;
}

/**
 * The first-open question, or `null` when it is not due: a browser has no shell,
 * the reader already has a folder or has answered before, or the shell could not
 * say. A failed read asks nothing, so a broken shell never blocks the app.
 */
export async function firstRunQuestion(
  source: WorkspaceSetupSource | null = desktop(),
): Promise<{ defaultFolder: string | null } | null> {
  if (!source?.workspaceSetup) return null;
  try {
    const setup = await source.workspaceSetup();
    return setup.needed ? { defaultFolder: setup.defaultFolder } : null;
  } catch {
    return null;
  }
}
