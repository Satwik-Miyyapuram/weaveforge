/**
 * Overleaf projects synced into vault subfolders over Overleaf's git bridge
 * (`https://git.overleaf.com/<id>`, user `git`, the Overleaf git token as the
 * password, branch `master`).
 *
 * Each link keeps its repository in the app's data folder, not in the vault,
 * so the vault's own history sees the project as plain files and there is no
 * nested `.git` inside it. The repository is keyed by vault, folder and
 * project: relinking a project to another folder starts a fresh one, because
 * the old one would read the new, empty folder as "every file deleted".
 *
 * Pull and push are `NativeWorkspaceGit`'s: local edits are committed first, a
 * conflicting pull changes nothing, and a push never forces.
 */

import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import * as path from "node:path";

import {
  SYNC_AUTHOR,
  type GitPullResult,
  type GitPushResult,
  type GitRemoteConfig,
  type GitRemoteStatus,
} from "@weaveforge/core";

import { OVERLEAF_PROJECT_ID, overleafGitUrl, parseOverleafProjectId } from "@/features/overleaf/domain/link-rules";

import type { IpcResult } from "./channels";
import { gitReason, NativeWorkspaceGit, redactAuth, serial } from "./vault-git";
import type { VaultSession } from "./vault-handlers";

export const OVERLEAF_SYNC_ACTIONS = ["list", "link", "unlink", "status", "pull", "push"] as const;
export type OverleafSyncAction = (typeof OVERLEAF_SYNC_ACTIONS)[number];

export interface OverleafLink {
  projectId: string;
  /** Vault-relative, forward slashes. */
  folder: string;
}

export interface OverleafSyncReply {
  links: OverleafLink[];
  hasToken: boolean;
  status?: GitRemoteStatus;
  pull?: GitPullResult;
  push?: GitPushResult;
}

export interface OverleafSyncDeps {
  vaultRoot: string;
  /** The app's data folder; the repositories live under `overleaf-git/`. */
  userData: string;
  token: string | null;
  links: { read(): Promise<OverleafLink[]>; write(links: readonly OverleafLink[]): Promise<void> };
  /** The clone URL for a project; tests point it at a local repository. */
  remoteUrl?: (projectId: string) => string;
}

const BRANCH = "master";
const USERNAME = "git";
const NOT_AN_ACTION = "That is not an Overleaf sync action.";
const NO_TOKEN = "Add your Overleaf git token first (Overleaf → Account settings → Git integration).";
const NOT_LINKED = "That Overleaf project is not linked to a folder.";
const BAD_PROJECT = "Paste the Overleaf project's URL or id.";

export type LinkFolderCheck = { ok: true; folder: string } | { ok: false; reason: string };

/**
 * A vault-relative folder with forward slashes: no `.`/`..` steps, no drive or
 * absolute path, nothing in `.weaveforge` (the app's own files) or a `.git`.
 */
export function checkLinkFolder(raw: unknown): LinkFolderCheck {
  const bad = { ok: false, reason: "Choose a folder inside the vault, like Overleaf/thesis." } as const;
  if (typeof raw !== "string") return bad;
  const folder = raw.trim().replace(/\/+$/, "");
  if (!folder || folder.length > 200 || folder.startsWith("/") || /[\\:]/.test(folder)) return bad;
  const parts = folder.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part === ".git")) return bad;
  if (parts[0] === ".weaveforge") return bad;
  return { ok: true, folder };
}

/** The stored links, keeping only well-formed entries. */
export function parseLinks(value: unknown): OverleafLink[] {
  if (typeof value !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const { projectId, folder } = (entry ?? {}) as Partial<OverleafLink>;
    const checked = checkLinkFolder(folder);
    return typeof projectId === "string" && OVERLEAF_PROJECT_ID.test(projectId) && checked.ok
      ? [{ projectId, folder: checked.folder }]
      : [];
  });
}

const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

const OUTSIDE = "That folder is outside the vault.";

async function insideVault(vaultRoot: string, folder: string): Promise<string> {
  const root = path.resolve(vaultRoot);
  const target = path.resolve(root, ...folder.split("/"));
  if (!target.startsWith(root + path.sep)) throw new Error(OUTSIDE);
  // A folder that already exists may be a link out of the vault; follow it.
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target).catch(() => null)]);
  if (realTarget && !realTarget.startsWith(realRoot + path.sep)) throw new Error(OUTSIDE);
  return target;
}

function gitDirFor(deps: OverleafSyncDeps, link: OverleafLink): string {
  const key = createHash("sha1").update(`${path.resolve(deps.vaultRoot)}\0${link.folder}`).digest("hex").slice(0, 12);
  return path.join(deps.userData, "overleaf-git", `${key}-${link.projectId}.git`);
}

export async function syncOverleaf(request: unknown, deps: OverleafSyncDeps): Promise<OverleafSyncReply> {
  const { action, projectId, folder } = (request ?? {}) as { action?: unknown; projectId?: unknown; folder?: unknown };
  if (!(OVERLEAF_SYNC_ACTIONS as readonly unknown[]).includes(action)) throw new Error(NOT_AN_ACTION);
  const hasToken = Boolean(deps.token);
  const links = await deps.links.read();
  const reply = (next: OverleafLink[] = links): OverleafSyncReply => ({ links: next, hasToken });

  switch (action as OverleafSyncAction) {
    case "list":
      return reply();
    case "link": {
      const id = typeof projectId === "string" ? parseOverleafProjectId(projectId) : null;
      if (!id) throw new Error(BAD_PROJECT);
      const checked = checkLinkFolder(folder === undefined || folder === "" ? `Overleaf/${id}` : folder);
      if (!checked.ok) throw new Error(checked.reason);
      if (links.some((link) => link.projectId === id)) throw new Error("That project is already linked to a folder.");
      if (links.some((link) => overlaps(link.folder, checked.folder))) {
        throw new Error("That folder is already synced with another project, or holds or sits inside one.");
      }
      await insideVault(deps.vaultRoot, checked.folder);
      const next = [...links, { projectId: id, folder: checked.folder }];
      await deps.links.write(next);
      return reply(next);
    }
    case "unlink": {
      // Forgets the link only: the files stay in the vault and on Overleaf.
      const next = links.filter((link) => link.projectId !== projectId);
      if (next.length === links.length) throw new Error(NOT_LINKED);
      await deps.links.write(next);
      return reply(next);
    }
  }

  const link = links.find((entry) => entry.projectId === projectId);
  if (!link) throw new Error(NOT_LINKED);
  if (!deps.token) throw new Error(NO_TOKEN);
  const root = await insideVault(deps.vaultRoot, link.folder);
  const remote: GitRemoteConfig = {
    url: (deps.remoteUrl ?? overleafGitUrl)(link.projectId),
    token: deps.token,
    username: USERNAME,
  };
  const repo = new NativeWorkspaceGit(root, { branch: BRANCH, gitDir: gitDirFor(deps, link) });
  try {
    return await serial(async () => {
      switch (action as "status" | "pull" | "push") {
        case "status":
          return { ...reply(), status: await repo.remoteStatus(remote) };
        case "pull":
          await mkdir(root, { recursive: true });
          return { ...reply(), pull: await repo.pull(remote, SYNC_AUTHOR) };
        case "push":
          await mkdir(root, { recursive: true });
          return { ...reply(), push: await repo.push(remote, SYNC_AUTHOR) };
      }
    });
  } catch (error) {
    throw new Error(redactAuth(gitReason(error), deps.token, USERNAME));
  }
}

/** The IPC side: the open folder's Overleaf links; the token and links come from the shell's stores. */
export async function syncOverleafFolder(
  session: VaultSession,
  request: unknown,
  deps: Omit<OverleafSyncDeps, "vaultRoot">,
): Promise<IpcResult<OverleafSyncReply>> {
  if (!session.root) return { ok: false, message: "No workspace folder is chosen yet." };
  try {
    return { ok: true, value: await syncOverleaf(request, { ...deps, vaultRoot: session.root.path }) };
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : "Overleaf sync failed." };
  }
}
