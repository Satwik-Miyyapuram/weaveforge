import type { IBlobStore, ICurrentUserProvider, IEncryptedBlobStore } from "@thesis/core";

const BUCKET = "report-images";
const SIGNED_TTL_S = 3600;

function asEncrypted(store: IBlobStore): IEncryptedBlobStore {
  return store as IEncryptedBlobStore;
}

/** Private report-section image storage — `{userId}/{sectionId}/{uuid}.{ext}`. */
export class ReportImageStore {
  constructor(
    private readonly blobs: IBlobStore,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get encrypted() {
    return asEncrypted(this.blobs);
  }

  async upload(sectionId: string, blob: Blob, ext: string): Promise<string> {
    const userId = await this.session.requireUserId();
    const path = `${userId}/${sectionId}/${crypto.randomUUID()}.${ext}`;
    await this.blobs.upload(BUCKET, path, blob, blob.type);
    return path;
  }

  async remove(path: string): Promise<void> {
    await this.blobs.remove(BUCKET, path);
  }

  async signedUrls(paths: string[]): Promise<(string | null)[]> {
    return this.blobs.signedUrls(BUCKET, paths, SIGNED_TTL_S);
  }

  async fetchDecrypted(path: string): Promise<Blob> {
    return this.encrypted.fetchDecrypted(BUCKET, path);
  }

  async fetchDecryptedMany(paths: readonly string[]): Promise<Map<string, Blob>> {
    const fetchMany = this.encrypted.fetchDecryptedMany;
    if (!fetchMany) {
      const out = new Map<string, Blob>();
      await Promise.all(
        paths.map(async (path) => {
          try {
            out.set(path, await this.fetchDecrypted(path));
          } catch {
            /* skip broken */
          }
        }),
      );
      return out;
    }
    return fetchMany.call(this.encrypted, BUCKET, paths);
  }
}
