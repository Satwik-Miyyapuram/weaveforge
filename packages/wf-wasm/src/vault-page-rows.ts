/**
 * Vault-page row mapping (Rust `vault::page_row`). The rows are the `vault_pages` columns; the
 * repositories that read and write them stay in the web app.
 */
import {
  vaultPageToDomain as rawVaultPageToDomain,
  vaultPageToSummaryDomain as rawVaultPageToSummaryDomain,
  vaultPageToRow as rawVaultPageToRow,
} from "../pkg/wf_wasm.js";
import type { VaultPage, VaultPageRow, VaultPageWriteRow } from "./bindings.js";

export type { VaultPageRow, VaultPageWriteRow } from "./bindings.js";

/** A stored row as a full page (body empty when the row has none). */
export function vaultPageToDomain(row: VaultPageRow): VaultPage {
  return rawVaultPageToDomain(row) as VaultPage;
}

/** A stored row as a summary page (no body; the preview in its place). */
export function vaultPageToSummaryDomain(row: VaultPageRow): VaultPage {
  return rawVaultPageToSummaryDomain(row) as VaultPage;
}

/** A page as the row it is written as. `updated_at` is never written; see the Rust doc. */
export function vaultPageToRow(page: VaultPage): VaultPageWriteRow {
  return rawVaultPageToRow(page) as VaultPageWriteRow;
}
