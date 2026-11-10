/**
 * Migrated-data warning (Rust `sync::migrated_notice`), re-exported from index.ts.
 * Keeps `migratedNotice` in apps/shell/sidecar/src/migrated-notice.ts; the marker read stays in TS.
 */
import { migratedNotice as rawMigratedNotice } from "../pkg/wf_wasm.js";

/** The warning for the marker's text, or `null` when there is no marker (`raw` is `null`). */
export function migratedNotice(raw: string | null): string | null {
  return rawMigratedNotice(raw ?? undefined) ?? null;
}
