/**
 * Project folder names (Rust `project_folder`), re-exported from index.ts.
 */
import { projectFolderName as rawProjectFolderName } from "../pkg/wf_wasm.js";

/** The project a folder stands for (its name minus a trailing `--xxxxxx` id suffix), or `undefined`. */
export function projectFolderName(dir: string): string | undefined {
  return rawProjectFolderName(dir);
}
