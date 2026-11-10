/**
 * Desktop shell path naming (Rust `shell_paths` and `mcp_config_rewrite::mcp_client_configs`), re-exported
 * from index.ts. The caller passes `path.sep` and `process.platform`; the file IO stays in TypeScript.
 */
import { homeConfigPath as rawHomeConfigPath, mcpClientConfigs as rawMcpClientConfigs } from "../pkg/wf_wasm.js";

/** The home pointer file for a build variant: `desktop.json`, or `desktop-<variant>.json`. */
export function homeConfigPath(home: string, variant: string | null, sep: string): string {
  return rawHomeConfigPath(home, variant ?? undefined, sep);
}

/** Cursor's and VS Code's user MCP config files on this platform, with the key their servers live under. */
export function mcpClientConfigs(
  home: string,
  platform: string,
  appData: string | null,
  sep: string,
): { file: string; key: "mcpServers" | "servers" }[] {
  return rawMcpClientConfigs(home, platform, appData ?? undefined, sep) as {
    file: string;
    key: "mcpServers" | "servers";
  }[];
}
