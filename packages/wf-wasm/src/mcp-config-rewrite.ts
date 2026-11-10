/**
 * MCP client config rewrite (Rust `mcp_config_rewrite`), re-exported from index.ts.
 * Each function keeps the signature of apps/shell/sidecar/src/mcp-rewrite.ts.
 */
import {
  isElectronMcpEntry as rawIsElectronMcpEntry,
  mcpFileOf as rawMcpFileOf,
  rewriteMcpConfig as rawRewriteMcpConfig,
} from "../pkg/wf_wasm.js";

/** True for an entry the Electron app wrote: run as Node, first arg the bridge script. */
export function isElectronMcpEntry(entry: unknown): boolean {
  return rawIsElectronMcpEntry(entry);
}

/** The MCP file name an env points at, by basename; `mcp.json` when none is set. */
export function mcpFileOf(env: unknown): string {
  return rawMcpFileOf(env);
}

/** The config with every Electron entry for this launch's MCP file moved to `launch`. */
export function rewriteMcpConfig(
  config: unknown,
  key: "mcpServers" | "servers",
  launch: { command: string; args: string[]; env: Record<string, string> },
): { changed: boolean; config: unknown } {
  return rawRewriteMcpConfig(config, key, launch) as { changed: boolean; config: unknown };
}
