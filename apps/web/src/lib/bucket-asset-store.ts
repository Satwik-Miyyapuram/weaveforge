import type { ICurrentUserProvider, IBlobFetcher } from "@weaveforge/core";

const SIGNED_TTL_S = 3600;

/**
 * A private bucket holding one feature's uploads, keyed `{userId}/{ownerId}/{uuid}.{ext}`.
 *
 * The user-id prefix is what RLS reads, so it is part of the path rather than
 * a column. Everything else here is the same four calls against {@link IBlobStore}
 * that report images, vault assets and paper images each used to spell out
 * for themselves — the bucket name was the only thing that differed.
 */
export class BucketAssetStore {
  constructor(
    protected readonly bucket: string,
    protected readonly blobs: IBlobFetcher,
    protected readonly session: ICurrentUserProvider,
  ) {}

  async upload(ownerId: string, blob: Blob, ext: string): Promise<string> {
    const userId = await this.session.requireUserId();
    const path = `${userId}/${ownerId}/${crypto.randomUUID()}.${ext}`;
    await this.blobs.upload(this.bucket, path, blob, blob.type);
    return path;
  }

  async remove(path: string): Promise<void> {
    await this.blobs.remove(this.bucket, path);
  }

  async signedUrls(paths: string[]): Promise<(string | null)[]> {
    return this.blobs.signedUrls(this.bucket, paths, SIGNED_TTL_S);
  }

  async fetchBlob(path: string): Promise<Blob> {
    return this.blobs.fetchBlob(this.bucket, path);
  }

  /**
   * A blob that fails is left out rather than failing the batch: these are
   * images in a note, and one that cannot be read should leave a gap, not
   * blank the page.
   */
  async fetchBlobs(paths: readonly string[]): Promise<Map<string, Blob>> {
    return this.blobs.fetchBlobs(this.bucket, paths);
  }
}
