import { AI_TOOL_NAMES, type AiToolName } from "./ai-types.js";

export interface AiMcpToolManifestEntry {
  name: AiToolName;
  readOnly: boolean;
  requiresBrowserPairing: true;
  requiresUserConfirmation: boolean;
}

/** Transport-neutral declaration used by a future MCP server and its tests. */
export function aiMcpToolManifest(): readonly AiMcpToolManifestEntry[] {
  return AI_TOOL_NAMES.map((name) => ({
    name,
    readOnly: name === "search_workspace" || name === "get_source_excerpt" || name === "get_workspace_outline",
    requiresBrowserPairing: true,
    requiresUserConfirmation: name.startsWith("propose_"),
  }));
}

export class AiBrowserPairingRequiredError extends Error {
  readonly code = "browser_pairing_required" as const;
  constructor() {
    super("Open WeaveForge and unlock encryption to access this workspace.");
    this.name = "AiBrowserPairingRequiredError";
  }
}
