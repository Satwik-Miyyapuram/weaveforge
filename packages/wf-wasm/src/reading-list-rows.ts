/**
 * Reading-list row mapping (Rust `reading_lists::list_row`). The rows are the table's columns;
 * the domain types are camelCase. The repositories that read and write them stay in the web app.
 */
import {
  readingListToDomain as rawReadingListToDomain,
  readingListToRow as rawReadingListToRow,
  readingListItemToDomain as rawReadingListItemToDomain,
  readingListItemToRow as rawReadingListItemToRow,
} from "../pkg/wf_wasm.js";
import type {
  ReadingList,
  ReadingListItem,
  ReadingListItemRow,
  ReadingListRow,
} from "./bindings.js";

export type { ReadingListItemRow, ReadingListRow } from "./bindings.js";

/** A stored list row as a domain list. */
export function readingListToDomain(row: ReadingListRow): ReadingList {
  return rawReadingListToDomain(row) as ReadingList;
}

/** A domain list as the row it is written as. */
export function readingListToRow(list: ReadingList): ReadingListRow {
  return rawReadingListToRow(list) as ReadingListRow;
}

/** A stored item row as a domain item. */
export function readingListItemToDomain(row: ReadingListItemRow): ReadingListItem {
  return rawReadingListItemToDomain(row) as ReadingListItem;
}

/** A domain item as the row it is written as. */
export function readingListItemToRow(item: ReadingListItem): ReadingListItemRow {
  return rawReadingListItemToRow(item) as ReadingListItemRow;
}
