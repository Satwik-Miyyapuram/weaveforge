import { AI_TOOL_NAMES, type AiToolName } from "./ai-types.js";

export interface AiMcpToolManifestEntry {
  name: AiToolName;
  readOnly: boolean;
  requiresBrowserPairing: true;
  requiresUserConfirmation: boolean;
  /**
   * Whether this tool's output is somebody else's writing.
   *
   * True for every tool that returns library content, which is every read tool:
   * a workspace exists to hold other people's papers and notes. A transport
   * must put such output through `mcpReadResult` rather than sending it raw —
   * declared here so that shipping it raw is a contradiction of the manifest
   * rather than an omission nobody notices.
   */
  resultsAreUntrusted: boolean;
}

const READ_TOOLS: readonly AiToolName[] = [
  "search_workspace",
  "get_source_excerpt",
  "get_workspace_outline",
];

/** Transport-neutral declaration used by a future MCP server and its tests. */
export function aiMcpToolManifest(): readonly AiMcpToolManifestEntry[] {
  return AI_TOOL_NAMES.map((name) => ({
    name,
    readOnly: READ_TOOLS.includes(name),
    requiresBrowserPairing: true,
    requiresUserConfirmation: name.startsWith("propose_"),
    resultsAreUntrusted: READ_TOOLS.includes(name),
  }));
}

export class AiBrowserPairingRequiredError extends Error {
  readonly code = "browser_pairing_required" as const;
  constructor() {
    super("Open WeaveForge and unlock encryption to access this workspace.");
    this.name = "AiBrowserPairingRequiredError";
  }
}
