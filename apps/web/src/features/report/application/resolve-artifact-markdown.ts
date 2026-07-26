/**
 * Pure markdown rewrite for `expartifact:` refs at render time (C4).
 * Kept out of the React component so it can be unit-tested under node:test.
 */

import type { Experiment } from "@thesis/core";
import {
  parseArtifactRefs,
  resolveArtifactRef,
  type ArtifactLookup,
  type ArtifactRef,
} from "./artifact-refs";

/** Same rules as artifact-refs `escapeAlt`, plus strip attr breakouts for XSS. */
export function safeArtifactCaption(alt: string | undefined): string {
  const cleaned = (alt ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/["'<>`\[\]]/g, "")
    .replace(/&/g, "")
    .trim();
  return cleaned || "artifact";
}

/** Only emit destinations the markdown renderer will turn into `<img>`. */
export function safeImageDestination(url: string): string | null {
  const trimmed = url.trim();
  if (!/^(https?:|blob:|vault:)/i.test(trimmed)) return null;
  // Drop characters that break out of `formatText` img attrs or Markdown dests.
  if (/["'<>`]/.test(trimmed)) return null;
  // encodeURIComponent leaves `()` alone; parentheses still truncate Markdown.
  return trimmed.replace(/[()\s]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function formatResolvedFigure(caption: string, artifactUrl: string, stale: boolean): string {
  const dest = safeImageDestination(artifactUrl);
  if (!dest) {
    return `> ⚠️ Artifact “${caption}” has no renderable URL.`;
  }
  const figure = `![${caption}](${dest})`;
  return stale
    ? `${figure}\n> ⚠️ Experiment is running but stale — this figure may be out of date.`
    : figure;
}

function renderOne(ref: ArtifactRef, lookup: ArtifactLookup): string {
  const resolution = resolveArtifactRef(ref, lookup);
  const caption = safeArtifactCaption(ref.alt);
  switch (resolution.status) {
    case "resolved":
      return formatResolvedFigure(caption, resolution.artifactName, false);
    case "experiment_stale":
      return formatResolvedFigure(caption, resolution.artifactName, true);
    case "experiment_not_found":
      return `> ⚠️ Missing experiment for artifact “${caption}”.`;
    case "artifact_not_found":
      return `> ⚠️ Artifact “${caption}” was not found on experiment ${resolution.experiment.name}.`;
  }
}

/** Replace `expartifact:` refs with a resolved figure or a warning block. */
export function resolveArtifactRefsMarkdown(
  body: string,
  experiments: readonly Experiment[],
): string {
  const refs = parseArtifactRefs(body);
  if (refs.length === 0) return body;

  const byId = new Map(experiments.map((e) => [e.id, e]));
  const lookup: ArtifactLookup = { getExperiment: (id) => byId.get(id) ?? null };

  let out = "";
  let cursor = 0;
  for (const ref of refs) {
    out += body.slice(cursor, ref.start);
    cursor = ref.end;
    out += renderOne(ref, lookup);
  }
  out += body.slice(cursor);
  return out;
}
