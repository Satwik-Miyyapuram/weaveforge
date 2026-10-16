/**
 * Rewrite blob references between the app's storage scheme and folder-relative
 * paths.
 *
 * This is what makes an exported folder actually render in Obsidian or VS Code:
 * `vault:userId/pageId/x.png` means nothing outside the app, `../assets/...`
 * means something everywhere.
 *
 * On the way back in, stored paths are never trusted verbatim. An app path
 * embeds the owner (`{userId}/{pageId}/{file}`), so a hand-edited file could
 * name another user's storage path. Import resolves references only against
 * files inside the imported `assets/` tree and re-anchors them to the importing
 * user; storage RLS is the backstop, not the primary control.
 */

import { normalizeMarkdownImageSyntax } from "../features/vault/domain/vault-page.js";
import { replaceImageRefs } from "../shared/markdown-image.js";
import { ASSET_DIR, assetPath } from "./folder-layout.js";

export type BlobScheme = "vault" | "paperimg" | "reportimg";

const SCHEME_SCOPE: Record<BlobScheme, "notes" | "papers" | "report"> = {
  vault: "notes",
  paperimg: "papers",
  reportimg: "report",
};

const BLOB_HEAD = /(vault|paperimg|reportimg):/;
const RELATIVE_HEAD = new RegExp(String.raw`(?:\.\./)*${ASSET_DIR}/(notes|papers|report)/`);

/** How many `../` hops from a file at `depth` directories deep back to root. */
function upTo(depth: number): string {
  return "../".repeat(Math.max(0, depth));
}

/**
 * App scheme → folder-relative. `filePath` is where the containing markdown
 * file sits, so the number of `../` hops is right for that file.
 */
export function toRelativeBlobLinks(
  body: string,
  filePath: string,
): { body: string; assets: { scheme: BlobScheme; storagePath: string; folderPath: string }[] } {
  const depth = filePath.split("/").length - 1;
  const assets: { scheme: BlobScheme; storagePath: string; folderPath: string }[] = [];

  const rewritten = replaceImageRefs(normalizeMarkdownImageSyntax(body), BLOB_HEAD, ({ alt, head, rest }) => {
    const kind = head[1] as BlobScheme;
    const folderPath = assetPath(SCHEME_SCOPE[kind], rest);
    assets.push({ scheme: kind, storagePath: rest, folderPath });
    return `![${alt}](${upTo(depth)}${folderPath})`;
  });

  return { body: rewritten, assets };
}

export interface ImportedAssetResolver {
  /**
   * Map a folder-relative asset path to a storage path under the importing
   * user's own namespace, or null when the file was not in the archive.
   */
  resolve(scope: "notes" | "papers" | "report", relativePath: string): string | null;
}

/**
 * Folder-relative → app scheme, re-anchored through the resolver.
 *
 * A reference the resolver does not recognise is left as written rather than
 * guessed at: an unresolvable image renders broken, which is visible and
 * harmless, whereas fabricating a storage path could point at someone else's
 * object.
 */
export function fromRelativeBlobLinks(body: string, resolver: ImportedAssetResolver): string {
  return replaceImageRefs(body, RELATIVE_HEAD, ({ alt, head, rest }) => {
    const scope = head[1] as "notes" | "papers" | "report";
    const storagePath = resolver.resolve(scope, rest);
    if (!storagePath) return null;
    const scheme = (Object.keys(SCHEME_SCOPE) as BlobScheme[]).find((key) => SCHEME_SCOPE[key] === scope);
    return scheme ? `![${alt}](${scheme}:${storagePath})` : null;
  });
}

/** Every folder-relative asset path a body references. */
export function relativeAssetPaths(body: string): { scope: string; path: string }[] {
  const out: { scope: string; path: string }[] = [];
  replaceImageRefs(body, RELATIVE_HEAD, ({ head, rest }) => {
    out.push({ scope: head[1]!, path: rest });
    return null;
  });
  return out;
}
