/**
 * Graph palette and tag colours (Rust `graph_colour`), re-exported from index.ts.
 * Keeps the names of apps/web/src/features/relations/domain/graph-palette.ts.
 */
import { graphPalette as rawGraphPalette, tagColor as rawTagColor } from "../pkg/wf_wasm.js";

/** Every fixed colour the citation graph draws. */
/** Narrowing: relation and readingStatus are Record<string,string>; Rust uses nested structs. */
export interface GraphPalette {
  /** Edge colour per relation type, keyed by snake_case relation name. */
  relation: Record<string, string>;
  /** Node colour per reading status. */
  readingStatus: Record<string, string>;
  note: string;
  paper: string;
  wikilink: string;
  report: string;
  experiment: string;
  experimentLink: string;
  uncoloured: string;
  rampGradient: string;
  /** Community colours, biggest first. */
  cluster: string[];
}

/** The fixed palette. Needs the wasm core loaded. */
export function graphPalette(): GraphPalette {
  return rawGraphPalette() as GraphPalette;
}

/** The hue for a tag: a string hash over 360 degrees at fixed saturation and lightness. */
export function tagColor(tag: string): string {
  return rawTagColor(tag);
}
