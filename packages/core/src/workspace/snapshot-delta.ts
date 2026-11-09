/**
 * Fetching only what changed.
 *
 * A snapshot reads every row of every entity, and for notes and papers those
 * rows carry bodies and abstracts — measured, 15 MB of JSON for a workspace of
 * 3 000 notes and 1 500 papers, downloaded again on every project load.
 *
 * The protocol here is two round trips instead of one, with the first being
 * tiny. Ask for ids and timestamps; compare against what is already held;
 * ask for the full rows of only the ones that differ.
 *
 * Deliberately not "give me everything changed since T". That cannot see a
 * deletion — a row that is gone reports nothing — so a snapshot built that way
 * accumulates entities the database no longer has, forever, and search answers
 * with them. Comparing the full id set costs one small query and is exact.
 */

import { rust } from "../shared/rust.js";

export interface EntityStamp {
  id: string;
  /** Any value that changes when the row does; compared, never parsed. */
  updatedAt: string;
}

/**
 * A reader that can describe itself cheaply before being read in full.
 *
 * Both methods are optional: an entity small enough that listing it costs
 * nothing has no reason to implement them, and the caller falls back to `list`.
 */
export interface DeltaLister<T> {
  list(): Promise<T[]>;
  listStamps?(): Promise<EntityStamp[]>;
  listByIds?(ids: readonly string[]): Promise<T[]>;
}

export interface DeltaPlan {
  /** Ids whose rows have to be fetched — new or changed. */
  fetch: string[];
  /** Ids held locally that the database no longer has. */
  drop: string[];
  /** True when nothing changed and the held rows can be reused as they are. */
  unchanged: boolean;
}

/**
 * Read an entity, fetching only what changed when the reader supports it.
 *
 * `stampOf` says which field is the row's version. It is passed in rather than
 * assumed, because not every entity spells it `updatedAt` — some only have a
 * `createdAt`, and for an append-only entity that is exactly as good.
 */
export async function readWithDelta<T extends { id: string }>(
  reader: DeltaLister<T>,
  held: readonly T[] | undefined,
  stampOf: (row: T) => string,
): Promise<T[]> {
  // Nothing held, or a reader that cannot describe itself: one full read.
  if (!held || !reader.listStamps || !reader.listByIds) return reader.list();

  const remote = await reader.listStamps();
  const heldStamps = new Map(held.map((row) => [row.id, stampOf(row)]));
  const plan = rust().planDelta(remote, heldStamps);

  if (plan.unchanged) return rust().applyDelta(held, [], remote);

  // A change touching most of the corpus is cheaper as one read than as a
  // by-id fetch of nearly everything plus the stamp query already paid for.
  if (plan.fetch.length > remote.length * 0.6) return reader.list();

  const fetched = plan.fetch.length ? await reader.listByIds(plan.fetch) : [];
  return rust().applyDelta(held, fetched, remote);
}
