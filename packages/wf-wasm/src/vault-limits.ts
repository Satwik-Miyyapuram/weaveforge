/**
 * Vault size-cap wording (Rust `sync::vault_limits`), re-exported from feature-wrappers.ts.
 * The byte caps stay as constants in apps/shell/sidecar/src/vault-handlers.ts.
 */
import { vaultTooLargeMessage as rawVaultTooLargeMessage } from "../pkg/wf_wasm.js";

/** Said when a file is too big to cross the bridge; names the cap in MB. */
export function vaultTooLargeMessage(capBytes: number): string {
  return rawVaultTooLargeMessage(capBytes);
}
