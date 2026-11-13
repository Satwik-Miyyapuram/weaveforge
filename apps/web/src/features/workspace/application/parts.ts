import { getContainer } from "@/bootstrap";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { notifyEach } from "@/lib/parts";
import { loadCore, readyCore, typedCore } from "@/lib/rust-core";
import type { IWorkspaceFs, WorkspaceProject, WorkspaceSnapshot } from "@weaveforge/core";
import type { ReanchorPlan } from "@weaveforge/wasm";

export type { ReanchorPlan } from "@weaveforge/wasm";

// --- active-project ---
/**
 * Which project a folder path belongs to.
 *
 * Every mirrored path is inside one project's folder, so anything that resolves
 * a folder path has to answer this first — the serializer, the mirror manifest,
 * the PDF and HTML caches, the editor's tree, the export, the MCP server. It
 * reads the container rather than a module-level variable, because the answer
 * changes as the reader switches project and a cached one would write the wrong
 * project's work into the wrong folder.
 *
 * A failure is loud on purpose. Every previous version of this question had a
 * silent fallback — "no project" meant the root — and that is how a run for one
 * project came to delete another's files. A caller with no project has nowhere
 * to write, and saying so is better than writing somewhere plausible.
 */
export async function activeProjectOrNull(): Promise<WorkspaceProject | null> {
  const projects = getContainer().projects;
  const id = projects.context.projectId;
  if (!id) return null;
  const project = (await projects.listProjects()).find((candidate) => candidate.id === id);
  return project ? { id: project.id, name: project.name } : null;
}

export async function activeProject(): Promise<WorkspaceProject> {
  const project = await activeProjectOrNull();
  if (!project) {
    const id = getContainer().projects.context.projectId;
    throw new Error(
      id
        ? `The open project (${id}) is not in the project list, so its folder cannot be named. Reopen it, then try again.`
        : "Each project has its own subfolder in the workspace folder. Open a project to write it.",
    );
  }
  return project;
}

/** The active project's folder, which is what every path builder wants. */
export async function activeProjectRoot(): Promise<string> {
  const core = await loadCore();
  return core.projectDir(await activeProject());
}

// --- asset-reanchor ---
/**
 * Deciding what an imported body's image links are allowed to point at.
 *
 * A storage path embeds its owner (`{userId}/{pageId}/{file}`), so a path
 * written in a markdown file is a claim, not a key. The rules live in Rust
 * (`plan_asset_reanchor`); this module adapts sets to the wasm arrays and maps
 * the snapshot shape to the bodies that can carry an image reference.
 */

/** Every folder path a set of bodies already points at. */
export function ownedAssetFolderPaths(bodies: readonly string[]): Set<string> {
  return new Set(readyCore().ownedAssetFolderPaths(bodies));
}

/**
 * Classify every asset reference in an imported body.
 *
 * Only `notes` assets are ever uploaded: they are filed under a vault page, and
 * a paper or report image arriving from outside has no equivalent home. Those
 * fall through to `unresolved` unless the workspace already owns them, which is
 * the round-trip case.
 */
export function planAssetReanchor(
  body: string,
  owned: ReadonlySet<string>,
  available: ReadonlySet<string>,
): ReanchorPlan {
  return readyCore().planAssetReanchor(body, [...owned], [...available]);
}

/** Every body the workspace holds that can carry an image reference. */
export function workspaceBodies(snapshot: WorkspaceSnapshot): string[] {
  return readyCore().workspaceBodies(
    snapshot.vaultPages.map((page) => page.body),
    snapshot.papers.map((paper) => paper.summary),
  );
}

// --- folder-watch-lost ---
/**
 * Whether the shell's folder watch has stopped seeing the folder.
 *
 * A rename, move or unplugged drive leaves the watch looking at nothing, and
 * outside edits stop arriving without a sound. The shell says so once; this
 * keeps what it said until the folder is let go or watched again, so the panel
 * can say it too.
 */
let lostReason: string | null = null;
const listeners = new Set<(reason: string | null) => void>();

function setLost(reason: string | null): void {
  if (reason === lostReason) return;
  lostReason = reason;
  notifyEach(listeners, "folder-watch-lost", reason);
}

/** What the shell said when the watch lost the folder, or null while it is watching. */
export function folderWatchLost(): string | null {
  return lostReason;
}

/** Hears each change of `folderWatchLost`; answers with the way to stop. */
export function onFolderWatchLost(listener: (reason: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Hear the shell say the watch lost its folder. Stopping, as closing the folder
 * or watching it again does, forgets what was said.
 */
export function watchForLoss(bridge: Pick<DesktopBridge, "onVaultWatchLost">): () => void {
  setLost(null);
  const stop = bridge.onVaultWatchLost?.((reason) => setLost(reason)) ?? (() => {});
  return () => {
    stop();
    setLost(null);
  };
}

// --- remove-project-folder ---
/**
 * Remove a deleted project's folder from the workspace.
 *
 * Found by its `--id6` suffix as well as its current name, so a folder named
 * before a rename still goes. Returns the folder removed, or null.
 */
export async function removeProjectFolder(fs: IWorkspaceFs, project: WorkspaceProject): Promise<string | null> {
  const core = await loadCore();
  const exact = core.projectDir(project);
  const tail = `--${typedCore().idSuffix(project.id)}`;
  const dirs = (await fs.list("")).filter((s) => s.kind === "dir").map((s) => s.path.split("/").pop() ?? "");
  const match = typedCore().pickProjectFolder(dirs, exact, tail) ?? null;
  if (!match) return null;
  await fs.remove(match, { recursive: true });
  return match;
}
