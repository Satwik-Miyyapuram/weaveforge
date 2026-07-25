/**
 * Experiment artifact references in report markdown.
 *
 * Syntax (parallel to `reportimg:` so it does not collide with wikilinks
 * `[[…]]` or ordinary image embeds):
 *
 *   ![caption](expartifact:<experimentId>/<artifactName>)
 *
 * Pure parse / format / resolve — no blob fetch, no Supabase.
 */

import {
  isStaleRunningExperiment,
  type Experiment,
  STALE_RUNNING_MS,
} from "@thesis/core";

export const EXPERIMENT_ARTIFACT_PREFIX = "expartifact:";

export interface ArtifactRef {
  experimentId: string;
  artifactName: string;
  /** Alt text from the markdown image, when present. */
  alt?: string;
}

export interface ParsedArtifactRef extends ArtifactRef {
  /** Inclusive start / exclusive end offsets into the source markdown. */
  start: number;
  end: number;
  /** Exact matched substring (for round-trip checks). */
  raw: string;
}

export type ArtifactResolution =
  | { status: "resolved"; experiment: Experiment; artifactName: string }
  | { status: "experiment_not_found"; ref: ArtifactRef }
  | { status: "artifact_not_found"; experiment: Experiment; ref: ArtifactRef }
  | { status: "experiment_stale"; experiment: Experiment; artifactName: string };

export interface ArtifactLookup {
  getExperiment(id: string): Experiment | null | undefined;
  /** Optional last metric activity (ms) for the stale-heartbeat rule. */
  lastMetricAtMs?(experimentId: string): number | undefined;
  nowMs?: number;
  staleMs?: number;
}

function escapeAlt(alt: string): string {
  // Strip brackets rather than backslash-escape — the parser uses `[^\]]*` and
  // cannot round-trip `\]` inside alt text.
  const s = alt
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\[\]]/g, "")
    .trim();
  return s || "artifact";
}

/** Inverse of parse — round-trips with the canonical form. */
export function serialiseArtifactRef(ref: ArtifactRef): string {
  const alt = escapeAlt(ref.alt ?? "artifact");
  return `![${alt}](${EXPERIMENT_ARTIFACT_PREFIX}${ref.experimentId}/${ref.artifactName})`;
}

const REF_RE = new RegExp(
  `!\\[([^\\]]*)\\]\\(${EXPERIMENT_ARTIFACT_PREFIX}([^)\\s]+)\\)`,
  "g",
);

/**
 * Extract every experiment-artifact reference with its source offsets.
 * Ignores wikilinks, reportimg embeds, and ordinary http(s) images.
 */
export function parseArtifactRefs(markdown: string): ParsedArtifactRef[] {
  const out: ParsedArtifactRef[] = [];
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(markdown)) !== null) {
    const raw = m[0]!;
    const alt = m[1] ?? "";
    const path = m[2] ?? "";
    const slash = path.indexOf("/");
    if (slash <= 0 || slash === path.length - 1) continue;
    const experimentId = path.slice(0, slash);
    const artifactName = path.slice(slash + 1);
    if (!experimentId || !artifactName) continue;
    out.push({
      experimentId,
      artifactName,
      alt: alt || undefined,
      start: m.index,
      end: m.index + raw.length,
      raw,
    });
  }
  return out;
}

export function resolveArtifactRef(
  ref: ArtifactRef,
  lookup: ArtifactLookup,
): ArtifactResolution {
  const experiment = lookup.getExperiment(ref.experimentId);
  if (!experiment) {
    return { status: "experiment_not_found", ref };
  }

  const stale = isStaleRunningExperiment(
    experiment,
    lookup.nowMs ?? Date.now(),
    lookup.staleMs ?? STALE_RUNNING_MS,
    lookup.lastMetricAtMs?.(ref.experimentId),
  );
  if (stale) {
    return { status: "experiment_stale", experiment, artifactName: ref.artifactName };
  }

  const artifacts = experiment.artifacts ?? [];
  if (!artifacts.includes(ref.artifactName)) {
    return { status: "artifact_not_found", experiment, ref };
  }

  return { status: "resolved", experiment, artifactName: ref.artifactName };
}
