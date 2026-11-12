import { rust } from "./rust.js";

// --- clock ---
/**
 * Time + id abstractions.
 *
 * Domain factories stay pure and testable by depending on these instead of
 * calling `Date`/`crypto` directly. Concrete implementations are injected at the
 * composition root (Dependency Inversion).
 */
export interface Clock {
  /** ISO-8601 timestamp, e.g. "2026-06-24T12:00:00.000Z". */
  nowIso(): string;
}

export interface IdGenerator {
  newId(): string;
}

/** Calendar date (yyyy-mm-dd) from an ISO timestamp. Rust: wf-core `calendar_date`. */
export function isoDate(iso: string): string {
  return rust().isoDate(iso);
}

// --- dates ---
/**
 * The machine's local calendar date as YYYY-MM-DD. "Today" for a person is
 * their own date: the UTC date is already tomorrow (or still yesterday) for
 * part of every day away from Greenwich.
 */
export function localIsoDate(now: Date = new Date()): string {
  return rust().localIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// --- map-limit ---
/**
 * Run work over a collection at most `limit` at a time.
 *
 * `Promise.all` is the right shape for a small fixed set and the wrong one for
 * a user-sized one. Choosing twenty figures starts twenty uploads; a screen with
 * twelve stale runs issues twelve PATCHes; on a phone connection that saturates
 * the radio for everything else, including the request the user is waiting on.
 * HTTP/2 multiplexing helps a little and does not change the arithmetic.
 *
 * The bound is a constant in the code rather than something a caller can grow.
 * Order is preserved, so the result can still be zipped against the input, and
 * a rejection propagates as it would from `Promise.all` — the callers that want
 * failures absorbed say so themselves, per item.
 */
export async function mapLimit<T, R>(
  inputs: readonly T[],
  limit: number,
  work: (input: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!(limit >= 1)) throw new RangeError("mapLimit needs a concurrency limit of at least 1");
  const results = new Array<R>(inputs.length);
  let next = 0;
  // After one item fails the call rejects, so starting more would be wasted work.
  let failed = false;
  const runners = Array.from({ length: Math.min(limit, inputs.length) }, async () => {
    for (;;) {
      if (failed) return;
      const index = next++;
      if (index >= inputs.length) return;
      try {
        results[index] = await work(inputs[index]!, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  await Promise.all(runners);
  return results;
}

// --- module ---
/**
 * Feature module descriptor.
 *
 * Each tracked concern (papers, experiments, logbook, report, meetings) exposes
 * one of these. The app shell collects descriptors from a registry and builds
 * navigation and routing dynamically, so adding a feature does NOT require
 * editing the shell (Open/Closed Principle).
 *
 * This type is intentionally UI-framework-agnostic: it references components and
 * routes by opaque handles so `packages/core` need not depend on React/Next.
 * The web app provides concrete handle types.
 */
export interface NavItem {
  /** Stable key, usually the module id. */
  readonly key: string;
  /** Human label shown in the nav/tab bar. */
  readonly label: string;
  /** Route path this nav item links to. */
  readonly path: string;
  /** Optional icon handle, resolved by the UI layer. */
  readonly icon?: string;
  /**
   * Whether this item belongs in the *mobile* bar and strip.
   *
   * Defaults to true. The desktop sidebar lists every destination; the phone
   * has one bar with six slots and a strip above the content, so a destination
   * that is a workspace rather than a screen — the editor, which needs the
   * width and has no phone layout — is declared out of it here rather than
   * filtered by id somewhere in the shell.
   */
  readonly mobile?: boolean;
  /**
   * Routes with no item of their own that light this one, so the reader is
   * never on a screen with nothing highlighted (the wiki lights Notes).
   */
  readonly alsoActiveOn?: readonly string[];
}

export interface RouteDef {
  readonly path: string;
  /** Opaque handle to a component, resolved by the UI layer. */
  readonly component: string;
}

export interface FeatureModule {
  /** Unique, stable id, e.g. "papers". */
  readonly id: string;
  /** Display title, e.g. "Papers". */
  readonly title: string;
  /** Sub-nav bucket key (library, work, write, …). Omit for top-level (e.g. dashboard). */
  readonly navGroup?: string;
  /** Settings / org / shared inbox — not in primary tab groups. */
  readonly shell?: boolean;
  /** Nav/tab-bar entries this module contributes. */
  readonly navItems: readonly NavItem[];
  /** Routes this module contributes. */
  readonly routes: readonly RouteDef[];
  /**
   * The module has nothing to show without a server, so a build that has no
   * server leaves it out entirely rather than shipping a screen that explains
   * itself. Sharing, supervision and anything that reads another account's
   * data is in this category; see the offline-first plan, D3 and D10.
   */
  readonly requiresNetwork?: boolean;
  /**
   * The module only makes sense inside the desktop shell — it needs keyboard
   * shortcuts a browser tab keeps for itself, or a window the shell owns — so
   * the served web build leaves it out, the same way an offline build leaves
   * out what needs a server.
   */
  readonly desktopOnly?: boolean;
  /** Migration file names this module owns (documentation/ordering aid). */
  readonly migrations?: readonly string[];
}

// --- repository ---
/**
 * Generic data-access contracts.
 *
 * Split into read and write halves so consumers depend only on what they need
 * (Interface Segregation Principle). A read-only view (e.g. a graph render)
 * depends on `IReadableRepository`; it never gains write power it shouldn't have.
 *
 * These interfaces live in the domain layer. Concrete persistence
 * (PostgREST, in-memory, SQLite) implements them in the infrastructure layer.
 * Nothing here knows how data is stored (Dependency Inversion Principle).
 */
/** An entity that can be persisted by id. */
export interface Identifiable {
  readonly id: string;
}

export interface IReadableRepository<T extends Identifiable, F = unknown> {
  getById(id: string): Promise<T | null>;
  list(filter?: F): Promise<T[]>;
}

export interface IWritableRepository<T extends Identifiable> {
  save(entity: T): Promise<void>;
  delete(id: string): Promise<void>;
}

// --- three-way-merge ---
/** Types for three-way-merge. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export type Row = Record<string, unknown>;

export interface FieldConflict {
  field: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

/** Named for the merge it belongs to; core already has a wiki-page merge. */
export interface FieldMergeResult {
  merged: Row;
  conflicts: FieldConflict[];
}

// --- tree ---
/**
 * The move guard report sections and vault pages share. Building a tree from
 * a flat list is in the Rust core (wf-core `tree::build_tree`).
 */
/**
 * Refuse to move `id` under `newParent` when `newParent` is `id` itself or one
 * of its descendants: the parent chain would loop and the tree would drop the
 * whole branch.
 *
 * Walks up from `newParent` with `parentOf`, which answers a node's parent id
 * and throws its own error when the node does not exist. A loop already in
 * the data ends the walk quietly: it is not this move's doing.
 */
export async function assertNotUnder(
  id: string,
  newParent: string,
  parentOf: (id: string) => Promise<string | undefined | null>,
  cycleError: () => Error,
): Promise<void> {
  let cursor: string | undefined | null = newParent;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) throw cycleError();
    if (seen.has(cursor)) return;
    seen.add(cursor);
    cursor = await parentOf(cursor);
  }
}
