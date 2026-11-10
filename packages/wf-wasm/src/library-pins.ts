/**
 * Pinned-screen index (Rust `library_pins::pinned_screen_index`), re-exported from index.ts. The
 * types mirror the Rust structs; they are not in bindings.ts yet.
 */
import type {
  GrantIndexEntry,
  LibraryPinIndexRow,
  PinnedScreenIndex,
  PinnedScreenIndexInput,
  PinnedSharedByEntry,
  ShareIndexRow,
} from "./bindings.js";

export {
  pinnedScreenIndex,
} from "../pkg/wf_wasm.js";

export type {
  GrantIndexEntry,
  LibraryPinIndexRow,
  PinnedScreenIndex,
  PinnedScreenIndexInput,
  PinnedSharedByEntry,
  ShareIndexRow,
} from "./bindings.js";

