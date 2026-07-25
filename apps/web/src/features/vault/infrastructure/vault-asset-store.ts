import type { IBlobStore, ICurrentUserProvider, IEncryptedBlobStore } from "@thesis/core";
import type { IVaultAssetStore } from "../domain/vault-assets";

const BUCKET = "vault-assets";
const SIGNED_TTL_S = 3600;

function asEncrypted(store: IBlobStore): IEncryptedBlobStore {
  return store as IEncryptedBlobStore;
}

/** Private vault image storage — `{userId}/{pageId}/{uuid}.ext`. */
export class VaultAssetStore implements IVaultAssetStore {
  constructor(
    private readonly blobs: IBlobStore,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get encrypted() {
    return asEncrypted(this.blobs);
  }

  async upload(pageId: string, blob: Blob, ext: string): Promise<string> {
    const userId = await this.session.requireUserId();
    const path = `${userId}/${pageId}/${crypto.randomUUID()}.${ext}`;
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
            // skip broken assets
          }
        }),
      );
      return out;
    }
    return fetchMany.call(this.encrypted, BUCKET, paths);
  }
}
