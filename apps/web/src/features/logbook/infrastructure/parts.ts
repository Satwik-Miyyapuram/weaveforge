import { BucketAssetStore } from "@/lib/parts-1";
import type { IBlobFetcher, ICurrentUserProvider } from "@weaveforge/core";

// --- log-image-store ---
/** Private log entry image storage — `{userId}/{entryId}/{uuid}.{ext}`. */
export class LogImageStore extends BucketAssetStore {
  constructor(blobs: IBlobFetcher, session: ICurrentUserProvider) {
    super("log-images", blobs, session);
  }
}
