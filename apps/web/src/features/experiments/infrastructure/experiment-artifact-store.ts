import type { IBlobStore, ICurrentUserProvider } from "@weaveforge/core";

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
  constructor(
    private readonly blobs: IBlobStore,
    private readonly session: ICurrentUserProvider,
  ) {}

  /**
   * Store one file a person attached, and return the entry to record.
   *
   * The key is `{userId}/{experimentId}/{uuid}/{name}`: the user id first
   * because that is what RLS reads, and a uuid directory rather than a uuid
   * filename so two figures called `loss.png` can both exist while the name
   * shown under each stays the one their author gave it.
   */
  async upload(experimentId: string, file: File): Promise<string> {
    const userId = await this.session.requireUserId();
    const path = `${userId}/${experimentId}/${crypto.randomUUID()}/${safeName(file.name)}`;
    await this.blobs.upload(BUCKET, path, file, file.type || "application/octet-stream");
    return path;
  }

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

/**
 * A filename that is safe as one storage key segment.
 *
 * Anything outside the allowlist becomes a dash, which is enough: the name is
 * a label, not an identifier, and the uuid above it is what makes the key
 * unique. A name that reduces to nothing gets one, because a key must not end
 * in an empty segment.
 */
export function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 128);
  return cleaned || "artifact";
}
