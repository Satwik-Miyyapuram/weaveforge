import type { IBlobStore, ICurrentUserProvider } from "@weaveforge/core";
import { BucketAssetStore } from "@/lib/bucket-asset-store";
import type { IVaultAssetStore } from "../domain/vault-assets";

/** Private vault image storage — `{userId}/{pageId}/{uuid}.{ext}`. */
export class VaultAssetStore extends BucketAssetStore implements IVaultAssetStore {
  constructor(blobs: IBlobStore, session: ICurrentUserProvider) {
    super("vault-assets", blobs, session);
  }
}
