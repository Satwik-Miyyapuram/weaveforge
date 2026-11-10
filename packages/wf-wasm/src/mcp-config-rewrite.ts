/**
 * MCP client config rewrite (Rust `mcp_config_rewrite`), re-exported from index.ts.
 * Each function keeps the signature of apps/shell/sidecar/src/mcp-rewrite.ts.
 */
import {
  rewriteMcpConfig as rawRewriteMcpConfig,
} from "../pkg/wf_wasm.js";

export {
  isElectronMcpEntry,
  mcpFileOf,
} from "../pkg/wf_wasm.js";

/** The config with every Electron entry for this launch's MCP file moved to `launch`. */
export function rewriteMcpConfig(
  config: unknown,
  key: "mcpServers" | "servers",
  launch: { command: string; args: string[]; env: Record<string, string> },
): { changed: boolean; config: unknown } {
  return rawRewriteMcpConfig(config, key, launch) as { changed: boolean; config: unknown };
}
