/**
 * Desktop update check (Rust `update_check`), re-exported from index.ts. The types mirror the Rust
 * structs; they are not in bindings.ts yet.
 */
import {
  isNewerVersion as rawIsNewerVersion,
  parseAppVersion as rawParseAppVersion,
  parseReleaseTag as rawParseReleaseTag,
} from "../pkg/wf_wasm.js";
import type {
  NewestRelease,
  ReleaseRow,
} from "./bindings.js";

export {
  newestDesktopRelease,
} from "../pkg/wf_wasm.js";

export type { NewestRelease, ReleaseRow } from "./bindings.js";

/** A version as three numbers, `[major, minor, patch]`. */
export type AppVersion = [number, number, number];

/** `v0.5.2` to `[0, 5, 2]`, or null for any other tag. */
export function parseReleaseTag(tag: string): AppVersion | null {
  return rawParseReleaseTag(tag) as AppVersion | null;
}

/** `0.5.2` to `[0, 5, 2]`, or null. */
export function parseAppVersion(version: string): AppVersion | null {
  return rawParseAppVersion(version) as AppVersion | null;
}

/** Whether `candidate` is a later version than `current`. */
export function isNewerVersion(candidate: AppVersion, current: AppVersion): boolean {
  return rawIsNewerVersion(candidate, current);
}

