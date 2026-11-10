export {
  chooseRoot,
  isSearchFile,
  isSkippedDir,
  isTemporaryName,
  rootVerdict,
  searchMatches,
  temporaryName,
} from "../pkg/wf_wasm.js";
/**
 * Vault folder and search rules (Rust `vault_search`), re-exported from index.ts. Walks, reads, realpath and
 * mkdir stay in TypeScript.
 */

export type RootVerdict = "notADirectory" | "existing" | "empty" | "notEmpty";
export type RootChoice = "use" | "nest" | "refuse";

