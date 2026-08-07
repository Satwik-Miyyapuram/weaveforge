import type { IBlobStore } from "@weaveforge/core";

const BUCKET = "experiment-artifacts";
const SIGNED_TTL_S = 3600;

/**
 * Signs experiment artifacts for viewing.
 *
 * `experiments.artifacts` holds two kinds of entry, and they have to keep
 * working side by side:
 *
 *   - a **storage path** (`{userId}/{experimentId}/{name}`) written by
 *     `log_bytes` through `/api/sdk/artifacts`
 *   - an **absolute URL** written by `log_artifact(url)`, which exists so a run
 *     can point at something already hosted elsewhere — a wandb run, an S3
 *     object
 *
 * Only the first kind is ours to sign. Telling them apart by "does this parse
 * as an absolute URL" is the whole rule.
 *
 * Paths are stored rather than signed URLs because a presigned URL is a
 * credential with an expiry, and SigV4 caps that at seven days no matter what
 * you ask for. Storing one as though it were an address gives you a link that
 * works all week and then serves an XML error forever.
 */
export class ExperimentArtifactStore {
  constructor(private readonly blobs: IBlobStore) {}

  /**
   * Resolve entries to viewable URLs, in the order given.
   *
   * Absolute URLs pass through untouched; storage paths are signed for an hour.
   * A path that cannot be signed comes back `null` so the caller can leave a
   * gap rather than render a broken image.
   */
  async viewUrls(entries: readonly string[]): Promise<(string | null)[]> {
    const paths = entries.filter((entry) => !isAbsoluteUrl(entry));
    const signed = paths.length ? await this.blobs.signedUrls(BUCKET, paths, SIGNED_TTL_S) : [];

    const byPath = new Map(paths.map((path, index) => [path, signed[index] ?? null]));
    return entries.map((entry) => (isAbsoluteUrl(entry) ? entry : (byPath.get(entry) ?? null)));
  }
}

/** `http(s)` only — a bare path must not be mistaken for a hosted link. */
export function isAbsoluteUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
