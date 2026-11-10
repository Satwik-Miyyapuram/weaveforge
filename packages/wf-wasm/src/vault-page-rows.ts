/**
 * Vault-page row mapping (Rust `vault::page_row`). The rows are the `vault_pages` columns; the
 * repositories that read and write them stay in the web app.
 */
import type {
  VaultPageRow,
  VaultPageWriteRow,
} from "./bindings.js";

export {
  vaultPageToDomain,
  vaultPageToRow,
  vaultPageToSummaryDomain,
} from "../pkg/wf_wasm.js";

export type { VaultPageRow, VaultPageWriteRow } from "./bindings.js";

