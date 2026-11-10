/**
 * The vault note template engine (Rust `vault::template`), re-exported from index.ts.
 * Templates use `{{var}}` substitution and region markers; see the Rust module docs.
 */
import {
  applyTemplate as rawApplyTemplate,
  defaultSourceNoteTemplate as rawDefaultSourceNoteTemplate,
  mergeTemplate as rawMergeTemplate,
  parseRegions as rawParseRegions,
  renderTemplate as rawRenderTemplate,
  stripRegionMarkers as rawStripRegionMarkers,
  substituteVariables as rawSubstituteVariables,
  wrapRegion as rawWrapRegion,
} from "../pkg/wf_wasm.js";

import type { RegionKind, Segment } from "./bindings.js";

export type { RegionKind, Segment };

/** The default source-note template text (generated metadata, editable summary, key points, notes). */
export function defaultSourceNoteTemplate(): string {
  return rawDefaultSourceNoteTemplate();
}

/** Substitute `{{key}}` from context; missing keys become "". */
export function substituteVariables(template: string, context: Record<string, unknown>): string {
  return rawSubstituteVariables(template, context);
}

/** `<!-- wf:kind:name -->body<!-- /wf:kind:name -->`. */
export function wrapRegion(kind: RegionKind, name: string, body: string): string {
  return rawWrapRegion(kind, name, body);
}

/** Text / region segments, or `{ ok: false }` when any marker is damaged. */
export function parseRegions(
  document: string,
): { ok: true; segments: Segment[] } | { ok: false; reason: "malformed_markers" } {
  return rawParseRegions(document) as { ok: true; segments: Segment[] } | { ok: false; reason: "malformed_markers" };
}

/** Remove region markers for display; the body text is kept. */
export function stripRegionMarkers(document: string): string {
  return rawStripRegionMarkers(document);
}

/** Render a template with variable substitution (markers left intact). */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return rawRenderTemplate(template, context);
}

/** Merge a rendered template into an existing document; malformed input keeps `existing`. */
export function mergeTemplate(existing: string, rendered: string): string {
  return rawMergeTemplate(existing, rendered);
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
