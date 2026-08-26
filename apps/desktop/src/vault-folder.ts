import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  WORKSPACE_META_DIR,
  safeWorkspacePath,
  type IWorkspaceFs,
  type WorkspaceStat,
} from "@weaveforge/core";

/**
 * The workspace folder, on a real disk.
 *
 * `IWorkspaceFs` is nine methods and no watching, which is what lets the same
 * serializer run against memory in a test and against a chosen directory here.
 * This file adds the two things a real filesystem needs and memory does not:
 * containment, so a path cannot leave the root even by way of a symlink, and a
 * judgement about which directories a user may hand us at all.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What a chosen directory may be used for. */
export type RootVerdict =
  | { ok: true; state: "empty" | "existing" }
  | { ok: false; reason: string };

const NOT_EMPTY =
  "That folder already has files in it. Pick an empty folder, or one WeaveForge already writes to.";
const NOT_A_DIRECTORY = "That is not a folder.";

/**
 * Decide whether a directory may become the workspace folder.
 *
 * The rule is narrow on purpose. Writing a workspace scatters a file per
 * entity, so pointing this at `Documents/` would bury a person's own files
 * among a thousand of ours with no way to tell them apart afterwards. An empty
 * folder is safe because there is nothing to bury, and a folder we already
 * wrote is safe because we can recognize our own — `.weaveforge/` is the mark,
 * and it is the one directory a user has no reason to create by hand.
 */
export async function verifyRoot(root: string): Promise<RootVerdict> {
  let entries: string[];
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) return { ok: false, reason: NOT_A_DIRECTORY };
    entries = await fs.readdir(root);
  } catch {
    return { ok: false, reason: NOT_A_DIRECTORY };
  }

  if (entries.includes(WORKSPACE_META_DIR)) return { ok: true, state: "existing" };
  // `.DS_Store` and friends are not files anyone chose to put there.
  const meaningful = entries.filter((entry) => !entry.startsWith("."));
  if (meaningful.length === 0) return { ok: true, state: "empty" };
  return { ok: false, reason: NOT_EMPTY };
}

/** A stable, non-reversible name for a root, for keying per-folder state. */
export function rootFingerprint(root: string): string {
  return createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);
}

async function assertInside(root: string, target: string): Promise<void> {
  // `safeWorkspacePath` already refused `..` and absolute paths, so the only
  // way out left is a symlink planted inside the folder. Resolve what actually
  // exists and check where it landed.
  let resolved = target;
  try {
    resolved = await fs.realpath(target);
  } catch {
    // Not created yet: the parent is what matters.
    try {
      resolved = path.join(await fs.realpath(path.dirname(target)), path.basename(target));
    } catch {
      return; // Nothing on disk yet; the join below cannot escape.
    }
  }
  const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
  const relative = path.relative(realRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the workspace folder: ${target}`);
  }
}

function statOf(entry: { name: string; isDirectory(): boolean }, at: string): string {
  return at ? `${at}/${entry.name}` : entry.name;
}

/** `IWorkspaceFs` over a directory, with every path checked twice. */
export class NodeWorkspaceFs implements IWorkspaceFs {
  constructor(private readonly root: string) {}

  private async resolve(relative: string): Promise<string> {
    const safe = safeWorkspacePath(relative);
    const target = path.join(this.root, safe);
    await assertInside(this.root, target);
    return target;
  }

  async readFile(relative: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(await this.resolve(relative)));
  }

  async readText(relative: string): Promise<string> {
    return decoder.decode(await this.readFile(relative));
  }

  async writeFile(relative: string, data: Uint8Array | string): Promise<void> {
    const target = await this.resolve(relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, typeof data === "string" ? encoder.encode(data) : data);
  }

  async remove(relative: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.rm(await this.resolve(relative), {
      recursive: options?.recursive ?? false,
      force: true,
    });
  }

  async mkdirp(relative: string): Promise<void> {
    await fs.mkdir(await this.resolve(relative), { recursive: true });
  }

  async list(dir: string): Promise<readonly WorkspaceStat[]> {
    const at = dir === "" || dir === "." ? "" : safeWorkspacePath(dir);
    const target = at ? await this.resolve(at) : this.root;
    const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => []);
    const out: WorkspaceStat[] = [];
    for (const entry of entries) {
      const relative = statOf(entry, at);
      const stat = await this.stat(relative);
      if (stat) out.push(stat);
    }
    return out;
  }

  async *walk(dir: string): AsyncIterable<WorkspaceStat> {
    for (const entry of await this.list(dir)) {
      if (entry.kind === "file") yield entry;
      else yield* this.walk(entry.path);
    }
  }

  async stat(relative: string): Promise<WorkspaceStat | null> {
    try {
      const safe = safeWorkspacePath(relative);
      const stat = await fs.stat(await this.resolve(safe));
      return {
        path: safe,
        size: stat.size,
        modifiedAt: new Date(stat.mtimeMs).toISOString(),
        kind: stat.isDirectory() ? "dir" : "file",
      };
    } catch {
      return null;
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const target = await this.resolve(to);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(await this.resolve(from), target);
  }
}
