/**
 * Markdown image and blob link helpers (Rust `markdown_images`), re-exported from index.ts.
 */
import {
  findImageRefs as rawFindImageRefs,
  fromRelativeBlobLinks as rawFromRelativeBlobLinks,
  imageAltFromFilename as rawImageAltFromFilename,
  imageExtensionForMime as rawImageExtensionForMime,
  imagePathsInBody as rawImagePathsInBody,
  markdownImage as rawMarkdownImage,
  normalizeMarkdownImageSyntax as rawNormalizeMarkdownImageSyntax,
  ownedAssetFolderPaths as rawOwnedAssetFolderPaths,
  parseMdImageAlt as rawParseMdImageAlt,
  planAssetReanchor as rawPlanAssetReanchor,
  relativeAssetPaths as rawRelativeAssetPaths,
  setImagePlacement as rawSetImagePlacement,
  stripUnresolvedImageRefs as rawStripUnresolvedImageRefs,
  toRelativeBlobLinks as rawToRelativeBlobLinks,
  withImageWidth as rawWithImageWidth,
  withMdImageAlt as rawWithMdImageAlt,
  workspaceBodies as rawWorkspaceBodies,
} from "../pkg/wf_wasm.js";
import type {
  FoundImageRef,
  ImagePlacementPatch,
  MdImageAlt,
  MdPlacement,
  ReanchorPlan,
  RelativeAsset,
  RelativeLinks,
} from "./bindings.js";
import { checkIndexText } from "./text-check.js";

export type { FoundImageRef };

/** The refs whose target starts with `head`, in body order, none rewritten (Rust `find_image_refs`). */
export function findImageRefs(body: string, head: string, allowSpace: boolean): FoundImageRef[] {
  checkIndexText(body);
  checkIndexText(head);
  return rawFindImageRefs(body, head, allowSpace) as FoundImageRef[];
}

/** A markdown image for `target` with `alt` text (Rust `markdown_image`). */
export function markdownImage(target: string, alt: string): string {
  checkIndexText(target);
  checkIndexText(alt);
  return rawMarkdownImage(target, alt);
}

/** Alt text from a file name (Rust `image_alt_from_filename`). */
export function imageAltFromFilename(name?: string | null): string {
  if (name) checkIndexText(name);
  return rawImageAltFromFilename(name ?? undefined);
}

/** File extension for an image MIME type (Rust `image_extension_for_mime`). */
export function imageExtensionForMime(mime: string): string {
  checkIndexText(mime);
  return rawImageExtensionForMime(mime);
}

/** Image targets in `body` under `prefix`. The body is normalised first; `prefix` is literal text, not a regex. */
export function imagePathsInBody(body: string, prefix: string): string[] {
  checkIndexText(body);
  checkIndexText(prefix);
  return rawImagePathsInBody(body, prefix) as string[];
}

/** `body` with markdown image syntax normalised (Rust `normalize_markdown_image_syntax`). */
export function normalizeMarkdownImageSyntax(body: string): string {
  checkIndexText(body);
  return rawNormalizeMarkdownImageSyntax(body);
}

/** `body` with blob links made relative to `filePath`, and the assets they name (Rust `to_relative_blob_links`). */
export function toRelativeBlobLinks(
  body: string,
  filePath: string,
): RelativeLinks {
  checkIndexText(body);
  checkIndexText(filePath);
  return rawToRelativeBlobLinks(body, filePath) as RelativeLinks;
}

/** The asset paths a body's relative links point at (Rust `relative_asset_paths`). */
export function relativeAssetPaths(body: string): RelativeAsset[] {
  checkIndexText(body);
  return rawRelativeAssetPaths(body) as RelativeAsset[];
}

/** Folder-relative asset links re-anchored; `resolved` maps `assets/<scope>/<path>` to a storage path (Rust `from_relative_blob_links_mapped`). */
export function fromRelativeBlobLinks(body: string, resolved: Readonly<Record<string, string>>): string {
  checkIndexText(body);
  return rawFromRelativeBlobLinks(body, resolved);
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

/** Classifies a body's asset refs as kept, uploaded or unresolved; `owned` and `available` are folder paths (Rust `plan_asset_reanchor`). */
export function planAssetReanchor(body: string, owned: readonly string[], available: readonly string[]): ReanchorPlan {
  checkIndexText(body);
  return rawPlanAssetReanchor(body, owned, available) as ReanchorPlan;
}

/** Drop `![alt](prefix+path)` refs whose path is not in `resolved` (Rust `strip_unresolved_image_refs`). */
export function stripUnresolvedImageRefs(body: string, prefix: string, paths: readonly string[], resolved: readonly string[]): string {
  checkIndexText(body);
  return rawStripUnresolvedImageRefs(body, prefix, paths, resolved);
}

/** Crop, side and width split out of an image alt (Rust `parse_md_image_alt`). */
export function parseMdImageAlt(raw: string): MdImageAlt {
  checkIndexText(raw);
  return rawParseMdImageAlt(raw) as MdImageAlt;
}

/** The alt for a figure's own text and placement, in the spelling the reader reads (Rust `with_md_image_alt`). */
export function withMdImageAlt(alt: string, placement: MdPlacement): string {
  checkIndexText(alt);
  return rawWithMdImageAlt(alt, placement);
}

/** The alt for a width, keeping any crop or side; `null` clears it (Rust `with_image_width`). */
export function withImageWidth(alt: string, width: string | null): string {
  checkIndexText(alt);
  return rawWithImageWidth(alt, width);
}

/** Rewrite the `ordinal`-th image whose alt is `alt` to the patched placement (Rust `set_image_placement`). */
export function setImagePlacement(body: string, alt: string, ordinal: number, patch: ImagePlacementPatch): string {
  checkIndexText(body);
  checkIndexText(alt);
  // serde reads a key that is present as an explicit null, so an absent (undefined) field is dropped here to keep its value.
  const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return rawSetImagePlacement(body, alt, ordinal, fields);
}
