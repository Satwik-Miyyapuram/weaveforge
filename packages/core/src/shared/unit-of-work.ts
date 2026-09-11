/**
 * The unit-of-work port — **designed, not implemented** (review-2 F11).
 *
 * ## The problem it is for
 *
 * Several use cases write to more than one aggregate and cannot be undone:
 *
 *   * `ManageTagsUseCase.mergeConcepts` (`features/tags/application/manage-tags.use-case.ts`)
 *     copies every link from one tag to another, deletes the originals, deletes
 *     the tag row, and then rewrites a denormalised `papers.tags[]` cache for
 *     every affected paper — four kinds of write to three tables, in a loop;
 *   * `reconcileSources` unlinks and relinks across `paper_tags` and then
 *     rewrites `papers.tags`;
 *   * `RevokeShareLinkUseCase` and `CheckCitationAlertsUseCase` each write a log
 *     entry and a track row that are meant to move together.
 *
 * A failure part-way through any of those leaves the denormalised cache
 * disagreeing with the link table. There is no rollback because
 * {@link IWritableRepository} is a set of independent calls that each commit on
 * their own, and the Supabase adapter issues one PostgREST request per call.
 *
 * ## Why this file is an interface and a note rather than a change
 *
 * A working unit of work is not a new file in this package. It requires, in
 * order:
 *
 *   1. **A transaction handle threaded through every write.** `save`/`delete`
 *      have no parameter for "as part of this transaction", so the port has to
 *      change to something like `save(entity, uow?)` — or the repositories have
 *      to be *constructed* per transaction. Either way it is a change to
 *      `IReadableRepository`/`IWritableRepository`, and therefore to all ~28
 *      interface implementations.
 *   2. **An adapter that can actually open one.** Supabase's JS client has no
 *      cross-request transaction over PostgREST; the realistic implementations
 *      are a Postgres function (`create function … security definer`) invoked
 *      with the whole operation, or a direct `pg` connection. The web app
 *      currently has neither, so this is a database change (owned elsewhere)
 *      before it is a domain change.
 *   3. **The in-memory doubles to honour it**, which is easy, and the SQLite /
 *      desktop adapters too.
 *
 * Points 1 and 2 are outside `packages/core` and outside this pass's ownership,
 * and doing 1 without 2 would leave every use case written against a port that
 * no shipped adapter can satisfy — a half-refactor that *looks* atomic and is
 * not, which is worse than the status quo because it would retire the
 * compensating logic that at least makes the current behaviour legible.
 *
 * So the shape is written down here, unimplemented and unexported from the
 * package index, to be picked up with the database work rather than ahead of
 * it. Nothing imports it and nothing behaves differently because of it.
 *
 * ## The shape it should take
 *
 * The contract below is deliberately minimal: a scope, and a way to run a
 * function inside it. The repositories are *not* referenced, because which
 * repositories participate is the caller's business (and threading them through
 * the port is point 1 above).
 */

/** A scope in which several writes either all land or none do. */
export interface IUnitOfWork {
  /**
   * Run `work` inside one transaction.
   *
   * The implementation must: begin; run `work`, passing it the handle its
   * repositories are bound to; commit if it resolves; roll back and rethrow if
   * it rejects. A nested call joins the outer transaction rather than opening a
   * second one, so a use case composed of use cases is still atomic.
   */
  run<T>(work: (scope: IUnitOfWorkScope) => Promise<T>): Promise<T>;
}

/**
 * What a participating repository needs from an in-flight transaction.
 *
 * A marker rather than a method set: the concrete adapters are the ones that
 * know how to turn it into a connection, a `set local` setting, or a Postgres
 * function argument. Keeping it opaque is what stops the domain from learning
 * which database it is talking to.
 */
export interface IUnitOfWorkScope {
  /** Opaque token the infrastructure layer understands; never inspected in core. */
  readonly token: unknown;
}
