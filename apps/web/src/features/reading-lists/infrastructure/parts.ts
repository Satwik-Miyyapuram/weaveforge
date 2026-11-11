import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import type { ProjectContext } from "@/lib/parts-2";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IReadingListItemRepository,
  IReadingListRepository,
  ReadingList,
  IScreeningRepository,
} from "@weaveforge/core";

// --- reading-list-repositories ---
/*
 * The reading-list repositories through the Rust step engine
 * (`crates/wf-core/src/repos/reading_lists.rs`, `reading_list_items.rs`,
 * `screening_decisions.rs`). Rust plans the queries and maps the rows; the tree is
 * `build_list_tree`, the same helper the in-memory implementation uses.
 */

/** `reading_lists`, scoped to the open project. `listByIds` is the batch read the facades duck-type. */
export type RustReadingListRepository = IReadingListRepository & {
  listByIds(ids: readonly string[]): Promise<ReadingList[]>;
};

export function rustReadingListRepository(db: SupabaseClient, project: ProjectContext): RustReadingListRepository {
  return rustRepository<RustReadingListRepository>(
    db,
    "reading_lists",
    ["getById", "listByIds", "list", "getTree", "save", "delete"],
    projectUserCtx(project),
  );
}

/** `reading_list_items`. Row-level security scopes them through their list. */
export function rustReadingListItemRepository(db: SupabaseClient): IReadingListItemRepository {
  return rustRepository<IReadingListItemRepository>(db, "reading_list_items", [
    "listItems",
    "listItemsForLists",
    "listsForPaper",
    "listsForNote",
    "find",
    "findNote",
    "add",
    "remove",
  ] as (keyof IReadingListItemRepository & string)[]);
}

/** `screening_decisions`. */
export function rustScreeningRepository(db: SupabaseClient): IScreeningRepository {
  return rustRepository<IScreeningRepository>(db, "screening_decisions", ["listForItems", "record", "remove"]);
}
