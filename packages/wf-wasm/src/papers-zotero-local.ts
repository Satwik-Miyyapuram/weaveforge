/**
 * Local Zotero API status rules (Rust `papers::zotero_local_status`), re-exported
 * from index.ts.
 */
import {
  usableStatus as rawUsableStatus,
  zoteroLocalApiOff as rawZoteroLocalApiOff,
  zoteroLocalStatusMessage as rawZoteroLocalStatusMessage,
} from "../pkg/wf_wasm.js";

/** The message for a 403 from the local API, which means its preference is off. */
export function zoteroLocalApiOff(): string {
  return rawZoteroLocalApiOff();
}

/** The reader-facing message for a status the local API answered with, or null. */
export function zoteroLocalStatusMessage(status: number): string | null {
  return rawZoteroLocalStatusMessage(status);
}

/** A status a Response can be built with; anything else becomes 500. */
export function usableStatus(status: number): number {
  return rawUsableStatus(status);
}
