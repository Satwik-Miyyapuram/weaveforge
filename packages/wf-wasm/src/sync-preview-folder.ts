/**
 * Folder preview read rule (Rust `sync::preview_folder`), re-exported from index.ts.
 * Keeps the signature of apps/web workspace/application/folder-preview-read.ts.
 */
import { readsFolder as rawReadsFolder } from "../pkg/wf_wasm.js";

/** Whether a top-level folder can hold anything a folder import preview reads. */
export function readsFolder(name: string, projectRoot: string, hasProjectDir: boolean): boolean {
  return rawReadsFolder(name, projectRoot, hasProjectDir);
}
