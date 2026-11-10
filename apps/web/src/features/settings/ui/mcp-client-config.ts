/**
 * The config each AI client takes to reach WeaveForge's MCP bridge, filled in with
 * this machine's launch line (the app's own binary run as Node, so no Node install).
 * The text is built by the Rust core (`mcp_client_config`).
 */
import { readyCore } from "@/lib/rust-core";

export interface McpLaunchLine {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type McpClientId = "claude-code" | "claude-desktop" | "codex" | "gemini" | "cursor" | "vscode" | "other";

export const MCP_CLIENT_TABS: readonly { id: McpClientId; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "other", label: "Other" },
];

export function claudeCodeCommands(): string {
  return readyCore().claudeCodeCommands();
}

export function geminiInstall(): string {
  return readyCore().geminiInstall();
}

/** The `[mcp_servers.weaveforge]` TOML table for Codex. */
export function codexToml(launch: McpLaunchLine): string {
  return readyCore().codexToml(launch);
}

/** The `mcpServers` shape Cursor, Windsurf, Cline, Zed, opencode and most others read. */
export function mcpServersJson(launch: McpLaunchLine): string {
  return readyCore().mcpServersJson(launch);
}

/** VS Code's `.vscode/mcp.json` shape. */
export function vscodeJson(launch: McpLaunchLine): string {
  return readyCore().vscodeJson(launch);
}
