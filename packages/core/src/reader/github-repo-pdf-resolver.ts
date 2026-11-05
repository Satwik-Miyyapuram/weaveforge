/**
 * GitHub repo ladder step: the PDF as a file in the workspace's GitHub repo.
 * The composition root turns a repo path into a fetchable URL (and holds any
 * token); this class only picks the path.
 */

import type { IPdfSourceResolver, PdfSourceHit, PdfSourcePaper } from "./pdf-source-ladder.js";

export interface GitHubRepoPdfResolverOptions {
  /** URL for a repo-relative path, or null when no repo is set up. */
  buildFileUrl: (repoPath: string) => string | null;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** A repo-relative path with no root, drive, scheme or `..` segment. */
function isSafeRepoPath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes(":")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export class GitHubRepoPdfResolver implements IPdfSourceResolver {
  readonly id = "github-repo";

  constructor(private readonly options: GitHubRepoPdfResolverOptions) {}

  supports(_paper: PdfSourcePaper): boolean {
    return true;
  }

  async resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null> {
    const path = repoPathOf(paper);
    if (!path) return null;
    const url = this.options.buildFileUrl(path)?.trim();
    return url ? { url } : null;
  }
}

/** `metadata.pdfPath` when safe, else the workspace layout `papers/pdf/<id>.pdf`. */
function repoPathOf(paper: PdfSourcePaper): string | null {
  const given = paper.metadata?.["pdfPath"];
  if (typeof given === "string" && isSafeRepoPath(given.trim())) return given.trim();
  return SAFE_ID.test(paper.id) ? `papers/pdf/${paper.id}.pdf` : null;
}
