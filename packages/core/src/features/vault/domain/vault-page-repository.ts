/**
 * Repository contract for vault pages.
 */

import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/repository.js";
import type {
  VaultPage,
  VaultPageFilter,
  VaultPageTreeNode,
} from "./vault-page.js";

export interface IVaultPageRepository
  extends IReadableRepository<VaultPage, VaultPageFilter>,
    IWritableRepository<VaultPage> {
  getTree(): Promise<VaultPageTreeNode[]>;
  /** Lightweight tree/card projection with bodyPreview; full body via getById. */
  listSummaries?(): Promise<VaultPage[]>;
}
