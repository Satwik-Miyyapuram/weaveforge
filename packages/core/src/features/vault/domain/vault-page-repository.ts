/**
 * Repository contract for vault pages.
 */

import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/parts.js";
import type {
  NewVaultPageInput,
  VaultPage,
  VaultPageFilter,
  VaultPageSummary,
  VaultPageTreeNode,
} from "../../../shared/core-contract.js";

/** The fields an edit may change. Absent leaves the field as it is. */
export interface EditVaultPageInput {
  title?: string;
  body?: string;
  /** A new parent; `null` moves the page to the top level. Absent leaves it. */
  parentId?: string | null;
  /** Pin or unpin the note. Absent leaves it. */
  pinned?: boolean;
  /**
   * The body the editor started from. Sent with `body` and nothing else, it
   * makes the save version-guarded: an edit someone else saved since is merged
   * in, or kept as a conflict copy, never overwritten (`repos::vault_page_guard`).
   */
  baseBody?: string;
  /** Digests of bodies this editor's live session saved; they are not someone else's edit. */
  sessionDigests?: readonly string[];
}

/**
 * The stored page after an edit; `conflictCopyId` names the copy a clashing edit
 * was kept in (the last one), `conflictCopyIds` every copy this save made.
 */
export type EditedVaultPage = VaultPage & { conflictCopyId?: string; conflictCopyIds?: string[] };

/** Vault-page writes that validate and apply changes (the Rust `vault_pages` arms). */
export interface IVaultPageManager {
  add(input: NewVaultPageInput): Promise<VaultPage>;
  update(id: string, input: EditVaultPageInput): Promise<EditedVaultPage>;
  remove(id: string): Promise<void>;
}

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
   * The tree/card projection with `bodyPreview`; the full body comes from
   * `getById` when a page is opened.
   *
   * Returns {@link VaultPageSummary}, not `VaultPage`: the projection has no
   * `body`, and typing it as a full page is how a card edit came to persist an
   * empty body (review-2 F6).
   *
   * Required, not optional — see `IPaperRepository.listSummaries` for why. An
   * implementation with no cheaper read returns `list()` here, which is a
   * statement about that implementation rather than a decision at every call
   * site.
   */
  listSummaries(): Promise<VaultPageSummary[]>;
  /**
   * True when another page (not `exceptId`) has this title under
   * `normalizeTitleKey`. A targeted read: the duplicate check used to load
   * every summary, once per note on an import.
   */
  titleTaken(title: string, exceptId?: string): Promise<boolean>;
}
