/**
 * MCP client config text for each AI client (Rust `mcp_client_config`),
 * re-exported from index.ts.
 */
import {
  claudeCodeCommands as rawClaudeCodeCommands,
  codexToml as rawCodexToml,
  geminiInstall as rawGeminiInstall,
  mcpServersJson as rawMcpServersJson,
  vscodeJson as rawVscodeJson,
} from "../pkg/wf_wasm.js";
import type { McpLaunchLine } from "./bindings.js";

export type { McpLaunchLine } from "./bindings.js";

/** The commands that add the WeaveForge plugin to Claude Code. */
export function claudeCodeCommands(): string {
  return rawClaudeCodeCommands();
}

/** The command that installs the WeaveForge extension into Gemini CLI. */
export function geminiInstall(): string {
  return rawGeminiInstall();
}

/** The `[mcp_servers.weaveforge]` TOML table for Codex. */
export function codexToml(launch: McpLaunchLine): string {
  return rawCodexToml(launch);
}

/** The `mcpServers` JSON shape most clients read. */
export function mcpServersJson(launch: McpLaunchLine): string {
  return rawMcpServersJson(launch);
}

/** VS Code's `.vscode/mcp.json` shape. */
export function vscodeJson(launch: McpLaunchLine): string {
  return rawVscodeJson(launch);
}
