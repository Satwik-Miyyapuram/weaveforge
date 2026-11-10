/**
 * Reading-list row mapping (Rust `reading_lists::list_row`). The rows are the table's columns;
 * the domain types are camelCase. The repositories that read and write them stay in the web app.
 */
import type {
  ReadingListItemRow,
  ReadingListRow,
} from "./bindings.js";

export {
  readingListItemToDomain,
  readingListItemToRow,
  readingListToDomain,
  readingListToRow,
} from "../pkg/wf_wasm.js";

export type { ReadingListItemRow, ReadingListRow } from "./bindings.js";

