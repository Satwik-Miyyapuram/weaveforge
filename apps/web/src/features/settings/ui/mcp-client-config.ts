/**
 * The config each AI client takes to reach WeaveForge's MCP bridge, filled in with
 * this machine's launch line (the app's own binary run as Node, so no Node install).
 */

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

const REPO = "Satwik-Miyyapuram/weaveforge";

export function claudeCodeCommands(): string {
  return `claude plugin marketplace add ${REPO}
claude plugin install weaveforge-research@weaveforge`;
}

export function geminiInstall(): string {
  return `gemini extensions install https://github.com/${REPO}`;
}

/** TOML basic strings take JSON's escapes, so JSON.stringify quotes them. */
export function codexToml(launch: McpLaunchLine): string {
  const q = (s: string) => JSON.stringify(s);
  const env = Object.entries(launch.env)
    .map(([k, v]) => `${k} = ${q(v)}`)
    .join(", ");
  return `[mcp_servers.weaveforge]
command = ${q(launch.command)}
args = [${launch.args.map(q).join(", ")}]
env = { ${env} }`;
}

/** The `mcpServers` shape Cursor, Windsurf, Cline, Zed, opencode and most others read. */
export function mcpServersJson(launch: McpLaunchLine): string {
  return JSON.stringify({ mcpServers: { weaveforge: launch } }, null, 2);
}

/** VS Code's `.vscode/mcp.json` shape. */
export function vscodeJson(launch: McpLaunchLine): string {
  return JSON.stringify({ servers: { weaveforge: { type: "stdio", ...launch } } }, null, 2);
}
