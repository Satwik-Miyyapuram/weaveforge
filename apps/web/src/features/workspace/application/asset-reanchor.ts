import type { WorkspaceSnapshot } from "@weaveforge/core";
import type { ReanchorPlan } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

export type { ReanchorPlan } from "@weaveforge/wasm";

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
