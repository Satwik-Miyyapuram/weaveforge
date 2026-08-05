import {
  NoOpWorkspaceGit,
  describeChanges,
  diffWorkspace,
  mirrorWorkspace,
  parseWorkspaceFolder,
  type ImportDiff,
  type IWorkspaceFs,
  type IWorkspaceGit,
  type MirrorResult,
  type WorkspaceCommit,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { BrowserWorkspaceFs } from "../infrastructure/browser-workspace-fs";
import { IsomorphicWorkspaceGit } from "../infrastructure/isomorphic-workspace-git";
import { sanitizeArchiveEntries, stripArchiveRoot } from "./import-limits";

/**
 * The workspace folder as the app uses it.
 *
 * Holds the chosen filesystem for the session. The handle is not persisted:
 * File System Access permission is per-session in most browsers anyway, and
 * silently reacquiring write access to a folder the user picked days ago is
 * not something to do on their behalf.
 */

let activeFs: IWorkspaceFs | null = null;
let activeGit: IWorkspaceGit = new NoOpWorkspaceGit();
let lastWrittenPaths: string[] = [];

export interface FolderSession {
  kind: "picked" | "opfs";
  git: "none" | "isomorphic";
}

export function folderSession(): FolderSession | null {
  if (!activeFs) return null;
  return {
    kind: activeFs instanceof BrowserWorkspaceFs ? "picked" : "opfs",
    git: activeGit.kind === "isomorphic" ? "isomorphic" : "none",
  };
}

export function supportsDirectoryPicker(): boolean {
  return BrowserWorkspaceFs.supportsDirectoryPicker;
}

/** Pick a real folder. Returns false when the user dismissed the picker. */
export async function chooseFolder(options: { git: boolean }): Promise<boolean> {
  const fs = await BrowserWorkspaceFs.pickDirectory();
  if (!fs) return false;
  activeFs = fs;
  activeGit = options.git ? new IsomorphicWorkspaceGit(fs) : new NoOpWorkspaceGit();
  lastWrittenPaths = [];
  return true;
}

/** Fall back to origin-private storage where the picker is unavailable. */
export async function openBrowserStorageFolder(options: { git: boolean }): Promise<void> {
  const fs = await BrowserWorkspaceFs.openOpfs();
  activeFs = fs;
  activeGit = options.git ? new IsomorphicWorkspaceGit(fs) : new NoOpWorkspaceGit();
  lastWrittenPaths = [];
}

export function closeFolder(): void {
  activeFs = null;
  activeGit = new NoOpWorkspaceGit();
  lastWrittenPaths = [];
}

export interface SyncOutcome {
  mirror: MirrorResult;
  commit: WorkspaceCommit | null;
}

/**
 * Write the workspace to the folder, then commit if versioning is on.
 *
 * Unchanged files are skipped, so a sync with nothing to do writes nothing and
 * produces no commit — which is what keeps the history readable.
 */
export async function syncToFolder(): Promise<SyncOutcome> {
  if (!activeFs) throw new Error("No folder is connected.");
  const container = getContainer();
  const snapshot = await container.workspace.snapshot();

  const mirror = await mirrorWorkspace(snapshot, activeFs, {
    previousPaths: lastWrittenPaths,
    fetchAsset: async (storagePath) => {
      const blobs = await container.vault.fetchAssetBlobs([storagePath]);
      const blob = blobs.get(storagePath);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
  });
  lastWrittenPaths = [...mirror.written, ...lastWrittenPaths.filter((p) => !mirror.removed.includes(p))];

  let commit: WorkspaceCommit | null = null;
  if (activeGit.kind !== "none") {
    if (!(await activeGit.isRepo())) await activeGit.init();
    const status = await activeGit.status();
    commit = await activeGit.commitAll(describeChanges(status), {
      name: "WeaveForge",
      email: "workspace@weaveforge.local",
    });
  }

  return { mirror, commit };
}

export async function folderHistory(limit = 20): Promise<readonly WorkspaceCommit[]> {
  return activeGit.log({ limit });
}

/**
 * Read the connected folder and diff it against the workspace.
 *
 * Preview only — nothing is written. This is the "edit in Obsidian, pull back
 * in" direction, and seeing "12 updated, 1 conflict" before committing to it is
 * the whole point.
 */
export async function previewFolderImport(): Promise<ImportDiff> {
  if (!activeFs) throw new Error("No folder is connected.");

  const files: Record<string, string> = {};
  for await (const entry of activeFs.walk("")) {
    if (!entry.path.endsWith(".md")) continue;
    files[entry.path] = await activeFs.readText(entry.path);
  }

  return diffAgainstWorkspace(files);
}

/** Diff a ZIP the user picked, without connecting a folder. */
export async function previewArchiveImport(bytes: Uint8Array): Promise<ImportDiff & { skipped: string[] }> {
  const { unzipSync } = await import("fflate");
  const { safe, skipped } = sanitizeArchiveEntries(unzipSync(bytes));
  const entries = stripArchiveRoot(safe);

  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.path.endsWith(".md")) continue;
    files[entry.path] = decoder.decode(entry.bytes);
  }

  return { ...(await diffAgainstWorkspace(files)), skipped };
}

async function diffAgainstWorkspace(files: Record<string, string>): Promise<ImportDiff> {
  const snapshot = await getContainer().workspace.snapshot();
  const existing = [
    ...snapshot.vaultPages.map((page) => ({
      id: page.id,
      type: "vault_page" as const,
      title: page.title,
      body: page.body,
    })),
    ...snapshot.papers.map((paper) => ({
      id: paper.id,
      type: "paper" as const,
      title: paper.title,
      body: paper.summary ?? "",
    })),
  ];

  return diffWorkspace(parseWorkspaceFolder(files), existing);
}

/**
 * Apply an import.
 *
 * Only notes are written. Papers, experiments, and the rest carry structured
 * fields that a markdown body cannot round-trip faithfully, and half-importing
 * a paper — body updated, metadata silently stale — is worse than not
 * importing it. Conflicts are never applied.
 */
export async function applyFolderImport(diff: ImportDiff): Promise<{ created: number; updated: number }> {
  const container = getContainer();
  let created = 0;
  let updated = 0;

  for (const entry of diff.entries) {
    if (entry.entity.type !== "vault_page") continue;
    if (entry.action === "conflict" || entry.action === "unchanged") continue;

    if (entry.action === "created") {
      await container.vault.manageVaultPage.add({
        title: entry.entity.title,
        body: entry.entity.body,
      });
      created += 1;
      continue;
    }

    if (!entry.entity.id) continue;
    const page = await container.vault.getPage(entry.entity.id);
    if (!page) continue;
    await container.vault.manageVaultPage.update(page.id, {
      title: entry.entity.title,
      body: entry.entity.body,
    });
    updated += 1;
  }

  if (created || updated) container.search.invalidate();
  return { created, updated };
}
