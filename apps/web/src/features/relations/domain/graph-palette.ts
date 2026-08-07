import type { RelationType } from "@weaveforge/core";

/**
 * Colours for every kind of node and edge on the citation graph.
 *
 * A leaf module on purpose: constants and one pure function, no imports beyond
 * a type. They used to live in `build-graph-data`, which reaches into the
 * reading-lists feature and from there into the app's Supabase wiring — so
 * anything wanting a single colour pulled the whole application in with it.
 * The statically exported pitch site needs exactly this palette and none of
 * that, and so does the legend.
 */

export const RELATION_COLORS: Record<RelationType, string> = {
  cites: "#8a857c",
  extends: "#7c9885",
  contradicts: "#c0573f",
  similar: "#c98a6b",
  builds_on: "#5a7d8c",
  uses_method: "#9a7bb0",
};

export const STATUS_COLORS: Record<string, string> = {
  to_read: "#b9b2a6",
  reading: "#7c9885",
  read: "#5a7d8c",
  skimmed: "#c98a6b",
};

export function tagColor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 62%)`;
}

export const NOTE_COLOR = "#a0896a";
/** Direct [[wikilink]] edges — distinct from tag/relation links. */
export const WIKILINK_COLOR = "#6f7f9c";
/** Report section nodes on the citation graph. */
export const REPORT_COLOR = "#5e8f7b";
