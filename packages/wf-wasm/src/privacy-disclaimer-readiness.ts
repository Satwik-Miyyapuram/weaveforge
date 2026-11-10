/**
 * Privacy-disclaimer shell gate (Rust `privacy_disclaimer_readiness`), re-exported from
 * index.ts. Both functions are pure: no I/O.
 */
import {
  shouldShowWorkspaceLoader as rawShouldShowWorkspaceLoader,
} from "../pkg/wf_wasm.js";

export {
  shouldMountShellChildren,
} from "../pkg/wf_wasm.js";

/**
 * Whether the workspace loader shows. `error` is the startup error text, or nothing; an
 * empty string counts as no error, as it does in Rust.
 */
export function shouldShowWorkspaceLoader(
  loading: boolean,
  needsPrivacyAccept: boolean,
  containerReady: boolean,
  error?: string | null,
): boolean {
  return rawShouldShowWorkspaceLoader(
    loading,
    needsPrivacyAccept,
    containerReady,
    error ?? undefined,
  );
}
