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
  return alt
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\[\]]/g, "")
    .trim();
}

function encodeRefPart(value: string): string {
  // encodeURIComponent leaves `!'()*` untouched; parentheses would terminate
  // the Markdown destination, so encode those remaining punctuation marks.
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Decode a path segment. Well-formed `%HH` sequences decode; bare `%` (e.g.
 * `100%done.png` or `%ZZ`) is kept as literal text rather than dropping the
 * whole ref. Empty / whitespace-only results are rejected by the caller.
 */
function decodeRefPart(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
  } catch {
    return null;
  }
}

/** Basename of an artifact URL or path — stable identity across signed-URL churn. */
export function artifactBasename(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  try {
    const path = new URL(trimmed).pathname;
    return decodeURIComponent(path.split("/").filter(Boolean).pop() || trimmed);
  } catch {
    return trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed;
  }
}

/**
 * Find the live artifact URL/name on an experiment that matches a stored ref.
 * Prefers exact match, then basename match (so `loss.png` resolves against a
 * signed `https://…/loss.png?token=…`).
 */
export function matchExperimentArtifact(
  artifacts: readonly string[],
  refName: string,
): string | null {
  if (artifacts.includes(refName)) return refName;
  const want = artifactBasename(refName);
  if (!want) return null;
  const hits = artifacts.filter((a) => artifactBasename(a) === want);
  // Basename collision across two live URLs — fail closed rather than pick wrong.
  if (hits.length !== 1) return null;
  return hits[0]!;
}

/** Inverse of parse — round-trips with the canonical form. */
export function serialiseArtifactRef(ref: ArtifactRef): string {
  // Preserve an explicit empty alt (`![](...)`); default only when omitted.
  const alt =
    ref.alt === undefined
      ? "artifact"
      : escapeAlt(ref.alt) || (ref.alt === "" ? "" : "artifact");
  const experimentId = encodeRefPart(ref.experimentId);
  const artifactName = encodeRefPart(ref.artifactName);
  return `![${alt}](${EXPERIMENT_ARTIFACT_PREFIX}${experimentId}/${artifactName})`;
}

const REF_RE = new RegExp(
  `!\\[([^\\]]*)\\]\\(${EXPERIMENT_ARTIFACT_PREFIX}([^)\\s]+)\\)`,
  "g",
);

/**
 * Extract every experiment-artifact reference with its source offsets.
 * Ignores wikilinks, reportimg embeds, and ordinary http(s) images.
 * Unencoded `(` in the path is rejected — Markdown destinations end at `)`,
 * so callers must percent-encode parentheses (see {@link serialiseArtifactRef}).
 */
export function parseArtifactRefs(markdown: string): ParsedArtifactRef[] {
  const out: ParsedArtifactRef[] = [];
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(markdown)) !== null) {
    const raw = m[0]!;
    const alt = m[1] ?? "";
    const path = m[2] ?? "";
    // Hand-written paths with raw `(` truncate at `)` — fail closed.
    if (path.includes("(")) continue;
    const slash = path.indexOf("/");
    if (slash <= 0 || slash === path.length - 1) continue;
    const experimentId = decodeRefPart(path.slice(0, slash));
    const artifactName = decodeRefPart(path.slice(slash + 1));
    if (experimentId == null || artifactName == null) continue;
    const id = experimentId.trim();
    const name = artifactName.trim();
    // Reject padded/whitespace-only ids; store trimmed so resolve matches.
    if (!id || !name) continue;
    if (id !== experimentId || name !== artifactName) continue;
    out.push({
      experimentId: id,
      artifactName: name,
      alt,
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

  const artifacts = experiment.artifacts ?? [];
  const matched = matchExperimentArtifact(artifacts, ref.artifactName);
  if (!matched) {
    return { status: "artifact_not_found", experiment, ref };
  }

  const stale = isStaleRunningExperiment(
    experiment,
    lookup.nowMs ?? Date.now(),
    lookup.staleMs ?? STALE_RUNNING_MS,
    lookup.lastMetricAtMs?.(ref.experimentId),
  );
  if (stale) {
    return { status: "experiment_stale", experiment, artifactName: matched };
  }

  return { status: "resolved", experiment, artifactName: matched };
}
