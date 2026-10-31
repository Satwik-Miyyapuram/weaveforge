/**
 * Rewrites the MCP client entries the Electron app wrote so they launch the bridge
 * with the Tauri app's bundled `node`. On first run this keeps Cursor and VS Code
 * working. Entries that are not ours are left alone.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { MCP_BRIDGE_FILE, type McpLaunch } from "./mcp-connect";

/** Which key a client config keeps its servers under. */
export type McpServersKey = "mcpServers" | "servers";

/** One client config file and the key its servers live under. */
export interface McpClientConfig {
  file: string;
  key: McpServersKey;
}

/** Cursor's and VS Code's user MCP configs on this OS. */
export function mcpClientConfigs(
  home: string,
  platform: NodeJS.Platform,
  appData: string | undefined,
): McpClientConfig[] {
  let vscodeDir: string;
  if (platform === "win32") {
    vscodeDir = path.join(appData ?? path.join(home, "AppData", "Roaming"), "Code", "User");
  } else if (platform === "darwin") {
    vscodeDir = path.join(home, "Library", "Application Support", "Code", "User");
  } else {
    vscodeDir = path.join(home, ".config", "Code", "User");
  }
  return [
    { file: path.join(home, ".cursor", "mcp.json"), key: "mcpServers" },
    { file: path.join(vscodeDir, "mcp.json"), key: "servers" },
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for an entry the Electron app wrote: run as Node, first arg the bridge script. */
export function isElectronEntry(entry: unknown): boolean {
  if (!isPlainObject(entry)) return false;
  const env = entry.env;
  if (!isPlainObject(env) || env.ELECTRON_RUN_AS_NODE !== "1") return false;
  const args = entry.args;
  if (!Array.isArray(args) || typeof args[0] !== "string") return false;
  const segments = args[0].split(/[\\/]/);
  return segments[segments.length - 1] === MCP_BRIDGE_FILE;
}

/** The config with every Electron entry under `key` moved to `launch`; others untouched. */
export function rewriteMcpConfig(
  config: unknown,
  key: McpServersKey,
  launch: McpLaunch,
): { changed: boolean; config: unknown } {
  if (!isPlainObject(config) || !isPlainObject(config[key])) {
    return { changed: false, config };
  }
  const nextServers: Record<string, unknown> = {};
  let changed = false;
  for (const [name, entry] of Object.entries(config[key])) {
    if (!isElectronEntry(entry)) {
      nextServers[name] = entry;
      continue;
    }
    const old = entry as Record<string, unknown>;
    const env: Record<string, unknown> = { ...(old.env as Record<string, unknown>) };
    delete env.ELECTRON_RUN_AS_NODE;
    nextServers[name] = {
      ...old,
      command: launch.command,
      args: [...launch.args],
      env: { ...env, ...launch.env },
    };
    changed = true;
  }
  if (!changed) return { changed: false, config };
  return { changed: true, config: { ...config, [key]: nextServers } };
}

/**
 * Rewrites one config file in place. A missing or unreadable file, or one that
 * is not JSON, is left alone and reports false.
 */
export async function rewriteMcpConfigFile(target: McpClientConfig, launch: McpLaunch): Promise<boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(target.file, "utf8"));
  } catch {
    return false;
  }
  const result = rewriteMcpConfig(parsed, target.key, launch);
  if (!result.changed) return false;
  const tmp = `${target.file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(result.config, null, 2)}\n`);
  await fs.rename(tmp, target.file);
  return true;
}

/** Rewrites every client config; returns the files it changed. */
export async function rewriteMcpClientConfigs(
  targets: readonly McpClientConfig[],
  launch: McpLaunch,
): Promise<string[]> {
  const changed: string[] = [];
  for (const target of targets) {
    if (await rewriteMcpConfigFile(target, launch)) changed.push(target.file);
  }
  return changed;
}
