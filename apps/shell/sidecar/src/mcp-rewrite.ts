/**
 * Rewrites the MCP client entries the Electron app wrote so they launch the bridge
 * with the Tauri app's bundled `node`. On first run this keeps Cursor and VS Code
 * working. Entries that are not ours are left alone.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { rust } from "@weaveforge/core";

import type { McpLaunch } from "./mcp-connect";

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

/** True for an entry the Electron app wrote: run as Node, first arg the bridge script. */
export function isElectronEntry(entry: unknown): boolean {
  return rust().isElectronMcpEntry(entry);
}

/** The MCP file a launch env points at, by basename; `mcp.json` when none is set. */
export function mcpFileOf(env: unknown): string {
  return rust().mcpFileOf(env);
}

/** The config with every Electron entry for this launch's MCP file moved to `launch`; others untouched. */
export function rewriteMcpConfig(
  config: unknown,
  key: McpServersKey,
  launch: McpLaunch,
): { changed: boolean; config: unknown } {
  const result = rust().rewriteMcpConfig(config, key, launch);
  // Rust hands back a copy; an untouched config stays the caller's own object.
  return result.changed ? result : { changed: false, config };
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
    const backup = `${target.file}.weaveforge.bak`;
    const created = await fs.writeFile(backup, original, { flag: "wx", mode }).then(
      () => true,
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        return false;
      },
    );
    // umask can strip bits from the create mode; an older backup is left as it is.
    if (created) await fs.chmod(backup, mode);
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
