/**
 * Folder-draft import rules (Rust `ai::folder_draft`), re-exported from index.ts.
 */
import {
  folderDraftForProject as rawFolderDraftForProject,
  isFolderDraftPath as rawIsFolderDraftPath,
} from "../pkg/wf_wasm.js";

/** Whether a file name is a folder draft (`.json`). */
export function isFolderDraftPath(path: string): boolean {
  return rawIsFolderDraftPath(path);
}

/** The parsed draft when it belongs to the project (or has no project), otherwise `null`. */
export function folderDraftForProject<T = unknown>(raw: string, projectId: string | undefined): T | null {
  return rawFolderDraftForProject(raw, projectId) as T | null;
}
