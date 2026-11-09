/**
 * GitHub repo ladder step: the PDF as a file in the workspace's GitHub repo.
 * The composition root turns a repo path into a fetchable URL (and holds any
 * token); this class only picks the path.
 */

import { rust } from "../shared/rust.js";
import type { IPdfSourceResolver, PdfSourceHit, PdfSourcePaper } from "./pdf-source-ladder.js";

export interface GitHubRepoPdfResolverOptions {
  /** URL for a repo-relative path, or null when no repo is set up. */
  buildFileUrl: (repoPath: string) => string | null;
}

export class GitHubRepoPdfResolver implements IPdfSourceResolver {
  readonly id = "github-repo";

  constructor(private readonly options: GitHubRepoPdfResolverOptions) {}

  supports(_paper: PdfSourcePaper): boolean {
    return true;
  }

  async resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null> {
    const given = paper.metadata?.["pdfPath"];
    const path = rust().githubRepoPdfPath(typeof given === "string" ? given : undefined, paper.id);
    if (!path) return null;
    const url = this.options.buildFileUrl(path)?.trim();
    return url ? { url } : null;
  }
}
