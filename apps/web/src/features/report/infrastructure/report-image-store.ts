import type { IBlobFetcher, ICurrentUserProvider } from "@weaveforge/core";
import { BucketAssetStore } from "@/lib/bucket-asset-store";

/** Private report-section image storage — `{userId}/{sectionId}/{uuid}.{ext}`. */
export class ReportImageStore extends BucketAssetStore {
  constructor(blobs: IBlobFetcher, session: ICurrentUserProvider) {
    super("report-images", blobs, session);
  }
}
