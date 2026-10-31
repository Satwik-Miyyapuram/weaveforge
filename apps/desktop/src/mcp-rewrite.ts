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

/** How one config file ended: rewritten, already current, or left alone because it could not be rewritten. */
export type McpRewriteOutcome = "changed" | "unchanged" | "skipped";

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

/** The MCP file a launch env points at, by basename; `mcp.json` when none is set. */
export function mcpFileOf(env: unknown): string {
  if (!isPlainObject(env)) return "mcp.json";
  const file = env.WEAVEFORGE_MCP_FILE;
  return typeof file === "string" && file !== "" ? path.basename(file) : "mcp.json";
}

/** The config with every Electron entry for this launch's MCP file moved to `launch`; others untouched. */
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
    if (!isElectronEntry(entry) || mcpFileOf((entry as Record<string, unknown>).env) !== mcpFileOf(launch.env)) {
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
 * Rewrites one config file in place. A missing file is "unchanged"; an unreadable
 * or non-JSON file (e.g. JSONC with comments) is "skipped" and left alone.
 */
export async function rewriteMcpConfigFile(
  target: McpClientConfig,
  launch: McpLaunch,
): Promise<McpRewriteOutcome> {
  let original: string;
  let mode: number;
  try {
    original = await fs.readFile(target.file, "utf8");
    // The config can hold other servers' API keys; the copies keep its permissions.
    mode = (await fs.stat(target.file)).mode & 0o777;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "unchanged" : "skipped";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(original);
  } catch {
    return "skipped";
  }
  const result = rewriteMcpConfig(parsed, target.key, launch);
  if (!result.changed) return "unchanged";
  const tmp = `${target.file}.${process.pid}.${Date.now()}.tmp`;
  try {
    // Keep the first original only; later rewrites must not replace it.
    await fs.writeFile(`${target.file}.weaveforge.bak`, original, { flag: "wx", mode }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    });
    await fs.writeFile(tmp, `${JSON.stringify(result.config, null, 2)}\n`, { mode });
    // umask can strip bits from the create mode, so set it exactly.
    await fs.chmod(tmp, mode);
    await fs.rename(tmp, target.file);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    return "skipped";
  }
  return "changed";
}

/** Rewrites every client config; returns the files it changed and the ones it skipped. */
export async function rewriteMcpClientConfigs(
  targets: readonly McpClientConfig[],
  launch: McpLaunch,
): Promise<{ changed: string[]; skipped: string[] }> {
  const changed: string[] = [];
  const skipped: string[] = [];
  for (const target of targets) {
    const outcome = await rewriteMcpConfigFile(target, launch);
    if (outcome === "changed") changed.push(target.file);
    if (outcome === "skipped") skipped.push(target.file);
  }
  return { changed, skipped };
}
