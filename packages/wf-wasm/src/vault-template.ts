/**
 * The vault note template engine (Rust `vault::template`), re-exported from index.ts.
 * Templates use `{{var}}` substitution and region markers; see the Rust module docs.
 */
import {
  applyTemplate as rawApplyTemplate,
  parseRegions as rawParseRegions,
} from "../pkg/wf_wasm.js";

import type {
  RegionKind,
  Segment,
} from "./bindings.js";

export {
  defaultSourceNoteTemplate,
  mergeTemplate,
  renderTemplate,
  stripRegionMarkers,
  substituteVariables,
  wrapRegion,
} from "../pkg/wf_wasm.js";

export type { RegionKind, Segment };

/** Text / region segments, or `{ ok: false }` when any marker is damaged. */
export function parseRegions(
  document: string,
): { ok: true; segments: Segment[] } | { ok: false; reason: "malformed_markers" } {
  return rawParseRegions(document) as { ok: true; segments: Segment[] } | { ok: false; reason: "malformed_markers" };
}

/**
 * First render (empty or whitespace-only `existing`) or merge on re-render.
 */
export function applyTemplate(
  existing: string | null | undefined,
  template: string,
  context: Record<string, unknown>,
): string {
  return rawApplyTemplate(existing ?? null, template, context);
}
