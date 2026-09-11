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
  VaultPageSummary,
  VaultPageTreeNode,
} from "./vault-page.js";

export interface IVaultPageRepository
  extends IReadableRepository<VaultPage, VaultPageFilter>,
    IWritableRepository<VaultPage> {
  /**
   * The nested tree the screen paints.
   *
   * Typed as {@link VaultPageSummary} nodes for the same reason
   * {@link listSummaries} is: every implementation builds it from the summary
   * columns, so the `page` on each node has no body. It used to claim
   * `VaultPage`, which is the same lie that let a card edit persist an empty
   * body (review-2 F6).
   */
  getTree(): Promise<VaultPageTreeNode<VaultPageSummary>[]>;
  /**
   * Lightweight tree/card projection with `bodyPreview`; the full body comes
   * from `getById` when a page is opened.
   *
   * Returns {@link VaultPageSummary}, not `VaultPage`: the projection has no
   * `body`, and typing it as a full page is how a card edit came to persist an
   * empty body (review-2 F6).
   */
  listSummaries?(): Promise<VaultPageSummary[]>;
}
