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

export type BlobScheme = "vault" | "paperimg" | "reportimg";

export const BLOB_SCHEMES: readonly BlobScheme[] = ["vault", "paperimg", "reportimg"];

const SCHEME_SCOPE: Record<BlobScheme, "notes" | "papers" | "report"> = {
  vault: "notes",
  paperimg: "papers",
  reportimg: "report",
};

const BLOB_REF_RE = /!\[([^\]]*)\]\((vault|paperimg|reportimg):([^)\s]+)\)/g;
const RELATIVE_REF_RE = /!\[([^\]]*)\]\((?:\.\.\/)*assets\/(notes|papers|report)\/([^)\s]+)\)/g;

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

  const rewritten = normalizeMarkdownImageSyntax(body).replace(
    BLOB_REF_RE,
    (_match, alt: string, scheme: string, storagePath: string) => {
      const kind = scheme as BlobScheme;
      const scope = SCHEME_SCOPE[kind];
      // Keep the owner/entity segments: they disambiguate files with the same
      // name across entities, and the importer re-anchors them anyway.
      const folderPath = `assets/${scope}/${storagePath}`;
      assets.push({ scheme: kind, storagePath, folderPath });
      return `![${alt}](${upTo(depth)}${folderPath})`;
    },
  );

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
  return body.replace(
    RELATIVE_REF_RE,
    (match, alt: string, scope: string, rest: string) => {
      const storagePath = resolver.resolve(scope as "notes" | "papers" | "report", rest);
      if (!storagePath) return match;
      const scheme = (Object.keys(SCHEME_SCOPE) as BlobScheme[]).find(
        (key) => SCHEME_SCOPE[key] === scope,
      );
      return scheme ? `![${alt}](${scheme}:${storagePath})` : match;
    },
  );
}

/** Every folder-relative asset path a body references. */
export function relativeAssetPaths(body: string): { scope: string; path: string }[] {
  const out: { scope: string; path: string }[] = [];
  RELATIVE_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RELATIVE_REF_RE.exec(body)) !== null) {
    out.push({ scope: match[2]!, path: match[3]! });
  }
  return out;
}
