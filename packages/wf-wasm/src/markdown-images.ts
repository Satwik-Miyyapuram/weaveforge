/**
 * Markdown image and blob link helpers (Rust `markdown_images`), re-exported from index.ts.
 */
import {
  imageAltFromFilename as rawImageAltFromFilename,
  ownedAssetFolderPaths as rawOwnedAssetFolderPaths,
  setImagePlacement as rawSetImagePlacement,
  workspaceBodies as rawWorkspaceBodies,
} from "../pkg/wf_wasm.js";
import type {
  FoundImageRef,
  ImagePlacementPatch,
} from "./bindings.js";
import { checkIndexText } from "./text-check.js";

export {
  findImageRefs,
  fromRelativeBlobLinks,
  imageExtensionForMime,
  imagePathsInBody,
  markdownImage,
  normalizeMarkdownImageSyntax,
  parseMdImageAlt,
  planAssetReanchor,
  relativeAssetPaths,
  stripUnresolvedImageRefs,
  toRelativeBlobLinks,
  withImageWidth,
  withMdImageAlt,
} from "../pkg/wf_wasm.js";

export type { FoundImageRef };

/** Alt text from a file name (Rust `image_alt_from_filename`). */
export function imageAltFromFilename(name?: string | null): string {
  return rawImageAltFromFilename(name ?? undefined);
}

/** The folder paths the bodies already point at (Rust `owned_asset_folder_paths`). */
export function ownedAssetFolderPaths(bodies: readonly string[]): string[] {
  for (const body of bodies) checkIndexText(body);
  return rawOwnedAssetFolderPaths(bodies) as string[];
}

/**
 * Every body that can carry an image reference (Rust `workspace_bodies`): vault page bodies,
 * then paper summaries, a missing summary as an empty body.
 */
export function workspaceBodies(
  vaultBodies: readonly string[],
  paperSummaries: readonly (string | null | undefined)[],
): string[] {
  return rawWorkspaceBodies(vaultBodies, paperSummaries) as string[];
}

/** Rewrite the `ordinal`-th image whose alt is `alt` to the patched placement (Rust `set_image_placement`). */
export function setImagePlacement(body: string, alt: string, ordinal: number, patch: ImagePlacementPatch): string {
  // serde reads a key that is present as an explicit null, so an absent (undefined) field is dropped here to keep its value.
  const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return rawSetImagePlacement(body, alt, ordinal, fields);
}
