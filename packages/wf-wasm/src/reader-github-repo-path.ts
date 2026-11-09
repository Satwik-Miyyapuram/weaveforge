/**
 * GitHub repo PDF path (Rust `reader::github_repo_path`), re-exported from index.ts.
 */
import { githubRepoPdfPath as rawGithubRepoPdfPath } from "../pkg/wf_wasm.js";

/**
 * The repo-relative path of a paper's PDF: `metadata.pdfPath` when safe, else
 * `papers/pdf/<id>.pdf` for a safe id, else null.
 */
export function githubRepoPdfPath(givenPdfPath: string | undefined, paperId: string): string | null {
  return rawGithubRepoPdfPath(givenPdfPath, paperId) ?? null;
}
