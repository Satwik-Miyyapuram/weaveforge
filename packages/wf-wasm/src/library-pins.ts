/**
 * Pinned-screen index (Rust `library_pins::pinned_screen_index`), re-exported from index.ts. The
 * types mirror the Rust structs; they are not in bindings.ts yet.
 */
import { pinnedScreenIndex as rawPinnedScreenIndex } from "../pkg/wf_wasm.js";
import type {
  GrantIndexEntry,
  LibraryPinIndexRow,
  PinnedScreenIndex,
  PinnedScreenIndexInput,
  PinnedSharedByEntry,
  ShareIndexRow,
} from "./bindings.js";

export type {
  GrantIndexEntry,
  LibraryPinIndexRow,
  PinnedScreenIndex,
  PinnedScreenIndexInput,
  PinnedSharedByEntry,
  ShareIndexRow,
} from "./bindings.js";

/** Index pins and shares for one screen: extra ids, owners and comment or edit rights. */
export function pinnedScreenIndex(input: PinnedScreenIndexInput): PinnedScreenIndex {
  return rawPinnedScreenIndex(input) as PinnedScreenIndex;
}
