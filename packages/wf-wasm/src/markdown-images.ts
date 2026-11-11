/**
 * Markdown image and blob link helpers (Rust `markdown_images`), re-exported from index.ts.
 */
import {
  ownedAssetFolderPaths as rawOwnedAssetFolderPaths,
  setImagePlacement as rawSetImagePlacement,
} from "../pkg/wf_wasm.js";
import type {
  FoundImageRef,
  ImagePlacementPatch,
} from "./bindings.js";
import { checkIndexText } from "./text-check.js";

export {
  findImageRefs,
  fromRelativeBlobLinks,
  imageAltFromFilename,
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
  workspaceBodies,
} from "../pkg/wf_wasm.js";

export type { FoundImageRef };

/** The folder paths the bodies already point at (Rust `owned_asset_folder_paths`). */
export function ownedAssetFolderPaths(bodies: readonly string[]): string[] {
  for (const body of bodies) checkIndexText(body);
  return rawOwnedAssetFolderPaths(bodies) as string[];
}

/** Rewrite the `ordinal`-th image whose alt is `alt` to the patched placement (Rust `set_image_placement`). */
export function setImagePlacement(body: string, alt: string, ordinal: number, patch: ImagePlacementPatch): string {
  // serde reads a key that is present as an explicit null, so an absent (undefined) field is dropped here to keep its value.
  const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return rawSetImagePlacement(body, alt, ordinal, fields);
}
