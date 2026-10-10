/**
 * The files Connect (Settings → AI & MCP) leaves for AI clients and the Python SDK.
 *
 * `~/.weaveforge/mcp.json` holds `{ url, apiUrl, token, tokenId }` for this user
 * only; the stdio bridge and its cached tool list sit in `~/.weaveforge/mcp/`, so a
 * client config points at a path that survives app updates. WeaveForge Dev writes
 * `mcp-dev.json` and `mcp-dev/` instead, and its launch line names that file.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { strToU8, zipSync } from "fflate";

import { HOME_CONFIG_DIR } from "./home-config";

export interface McpPaths {
  /** The token file. */
  file: string;
  /** Where the bridge script and `tools.json` are copied. */
  dir: string;
  /** The bridge inside the app bundle. */
  bridgeSource: string;
}

export interface McpConnection {
  url: string;
  apiUrl: string;
  token: string;
  tokenId: string;
}

/** How an MCP client starts the bridge: the app's own binary, run as Node. */
export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const MCP_BRIDGE_FILE = "weaveforge-mcp.mjs";
/** Read, drafts, and experiment logging for the agent's training scripts. */
export const MCP_CLIENT_PERMISSIONS = ["mcp:read", "mcp:suggest", "experiments"] as const;
export const MCP_CLIENT_TOKEN_NAME = "AI clients";

export function mcpPaths(home: string, variant: string | undefined, bridgeSource: string): McpPaths {
  const base = path.join(home, HOME_CONFIG_DIR);
  const stem = variant ? `mcp-${variant}` : "mcp";
  return { file: path.join(base, `${stem}.json`), dir: path.join(base, stem), bridgeSource };
}

export async function readMcpConnection(file: string): Promise<McpConnection | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as Partial<McpConnection>;
    const fields = [value.url, value.apiUrl, value.token, value.tokenId];
    return fields.every((f) => typeof f === "string" && f) ? (value as McpConnection) : null;
  } catch {
    return null;
  }
}

export async function writeMcpConnection(
  paths: McpPaths,
  connection: McpConnection,
  tools: readonly unknown[],
): Promise<void> {
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.file, `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created.
  await fs.chmod(paths.file, 0o600);
  // readFile, not copyFile: the source sits inside the asar.
  await fs.writeFile(path.join(paths.dir, MCP_BRIDGE_FILE), await fs.readFile(paths.bridgeSource));
  await fs.writeFile(path.join(paths.dir, "tools.json"), `${JSON.stringify({ tools }, null, 2)}\n`);
}

export async function removeMcpConnection(file: string): Promise<void> {
  await fs.rm(file, { force: true });
}

export function mcpLaunch(paths: McpPaths, execPath: string): McpLaunch {
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
  if (path.basename(paths.file) !== "mcp.json") env.WEAVEFORGE_MCP_FILE = paths.file;
  return { command: execPath, args: [path.join(paths.dir, MCP_BRIDGE_FILE)], env };
}

/** The clients the app opens itself; anything else gets a snippet to copy. */
export const MCP_OPEN_CLIENTS = ["cursor", "vscode", "claude-desktop"] as const;
export type McpOpenClient = (typeof MCP_OPEN_CLIENTS)[number];

/** Cursor's install link: the launch as base64 JSON. */
export function cursorInstallLink(launch: McpLaunch): string {
  const config = Buffer.from(JSON.stringify(launch)).toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=weaveforge&config=${encodeURIComponent(config)}`;
}

/** VS Code's install link: the server entry as URL-encoded JSON. */
export function vscodeInstallLink(launch: McpLaunch): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "weaveforge", ...launch }))}`;
}

/**
 * A Claude Desktop extension (.mcpb): the bridge run by Claude's own Node, so the
 * install dialog needs no paths. Dev's token file rides in the manifest's env.
 */
export function mcpbBundle(bridge: Uint8Array, tools: readonly unknown[], version: string, launch: McpLaunch): Uint8Array {
  const { ELECTRON_RUN_AS_NODE: _, ...env } = launch.env;
  const manifest = {
    manifest_version: "0.2",
    name: "weaveforge",
    display_name: "WeaveForge",
    version,
    description: "Read and search your WeaveForge workspace, leave drafts to approve, and log experiments. Runs on this computer only.",
    author: { name: "WeaveForge", url: "https://weaveforge.org" },
    homepage: "https://weaveforge.org",
    license: "AGPL-3.0-only",
    server: {
      type: "node",
      entry_point: "server/index.mjs",
      mcp_config: { command: "node", args: ["${__dirname}/server/index.mjs"], env },
    },
  };
  return zipSync({
    "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
    "server/index.mjs": bridge,
    "server/tools.json": strToU8(`${JSON.stringify({ tools }, null, 2)}\n`),
  });
}

/** Writes the .mcpb beside the bridge and returns its path. */
export async function writeMcpb(paths: McpPaths, tools: readonly unknown[], version: string, launch: McpLaunch): Promise<string> {
  const file = path.join(paths.dir, "weaveforge.mcpb");
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(file, mcpbBundle(await fs.readFile(paths.bridgeSource), tools, version, launch));
  return file;
}
