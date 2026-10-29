import type { IBlobFetcher, ICurrentUserProvider } from "@weaveforge/core";
import { BucketAssetStore } from "@/lib/bucket-asset-store";

/** Private log entry image storage — `{userId}/{entryId}/{uuid}.{ext}`. */
export class LogImageStore extends BucketAssetStore {
  constructor(blobs: IBlobFetcher, session: ICurrentUserProvider) {
    super("log-images", blobs, session);
  }
}
