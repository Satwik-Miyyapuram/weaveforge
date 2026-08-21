import { ASSET_DIR, relativeAssetPaths, toRelativeBlobLinks } from "@weaveforge/core";

/**
 * Deciding what an imported body's image links are allowed to point at.
 *
 * A storage path embeds its owner (`{userId}/{pageId}/{file}`), so a path
 * written in a markdown file is a claim, not a key. This is where the claim is
 * checked, kept pure and separate from the uploading so the rules can be tested
 * without a container: given what the workspace already owns and what actually
 * arrived in the import, decide which references are honoured, which are
 * re-anchored under the importing user, and which are left alone.
 */

interface AssetRef {
  /** Folder path, e.g. `assets/notes/{userId}/{pageId}/x.png`. */
  folderPath: string;
  /** The part after the scope directory — the claimed storage path. */
  storagePath: string;
  scope: string;
}

export interface ReanchorPlan {
  /** Already referenced by this workspace: honour the path as written. */
  keep: AssetRef[];
  /** Came with the import: upload under this user and rewrite to the new path. */
  upload: AssetRef[];
  /** Neither. Left as written, which renders broken rather than resolving
   *  to an object the importer has no demonstrated claim to. */
  unresolved: AssetRef[];
}

/** Every folder path a set of bodies already points at. */
export function ownedAssetFolderPaths(bodies: readonly string[]): Set<string> {
  const owned = new Set<string>();
  for (const body of bodies) {
    // Reuse the write-side rewriter rather than a second regex: whatever path
    // it produces on export is exactly what has to be recognised on import.
    for (const asset of toRelativeBlobLinks(body, "x.md").assets) owned.add(asset.folderPath);
  }
  return owned;
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
  const plan: ReanchorPlan = { keep: [], upload: [], unresolved: [] };
  const seen = new Set<string>();

  for (const ref of relativeAssetPaths(body)) {
    const folderPath = `${ASSET_DIR}/${ref.scope}/${ref.path}`;
    if (seen.has(folderPath)) continue;
    seen.add(folderPath);

    const entry: AssetRef = { folderPath, storagePath: ref.path, scope: ref.scope };
    if (owned.has(folderPath)) plan.keep.push(entry);
    else if (ref.scope === "notes" && available.has(folderPath)) plan.upload.push(entry);
    else plan.unresolved.push(entry);
  }

  return plan;
}

/**
 * Content type for an imported asset.
 *
 * Derived from the extension rather than sniffed. SVG is deliberately not
 * served as `image/svg+xml`: that type is a scripting context, and an imported
 * file is stored, not trusted. Anything unrecognised gets the same treatment.
 */
export function assetMimeType(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

/** Lowercased extension of a path, defaulting to `png` when there is none. */
export function assetExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  if (dot <= slash + 1) return "png";
  return path.slice(dot + 1).toLowerCase();
}
