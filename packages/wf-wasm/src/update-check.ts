/**
 * Desktop update check (Rust `update_check`), re-exported from index.ts. The types mirror the Rust
 * structs; they are not in bindings.ts yet.
 */
export {
  isNewerVersion,
  newestDesktopRelease,
  parseAppVersion,
  parseReleaseTag,
} from "../pkg/wf_wasm.js";

export type { NewestRelease, ReleaseRow } from "./bindings.js";

/** A version as three numbers, `[major, minor, patch]`. */
export type AppVersion = [number, number, number];

