import { BucketAssetStore } from "@/lib/parts-1";
import type { IBlobFetcher, ICurrentUserProvider } from "@weaveforge/core";

// --- report-image-store ---
/** Private report-section image storage — `{userId}/{sectionId}/{uuid}.{ext}`. */
export class ReportImageStore extends BucketAssetStore {
  constructor(blobs: IBlobFetcher, session: ICurrentUserProvider) {
    super("report-images", blobs, session);
  }
}
