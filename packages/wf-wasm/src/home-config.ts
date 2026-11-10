/**
 * Workspace-folder pointer parse (Rust `home_config`), re-exported from index.ts.
 * Keeps the parse of apps/shell/sidecar/src/home-config.ts; the file read stays in TS.
 */
import { vaultRootFromText as rawVaultRootFromText } from "../pkg/wf_wasm.js";

/** The `vaultRoot` a home config file names, or `null` when there is none. */
export function vaultRootFromText(text: string): string | null {
  return rawVaultRootFromText(text) ?? null;
}
