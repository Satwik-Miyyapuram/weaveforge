import type { IBlobStore, ICurrentUserProvider } from "@weaveforge/core";
import { BucketAssetStore } from "@/lib/bucket-asset-store";

/** Private report-section image storage — `{userId}/{sectionId}/{uuid}.{ext}`. */
export class ReportImageStore extends BucketAssetStore {
  constructor(blobs: IBlobStore, session: ICurrentUserProvider) {
    super("report-images", blobs, session);
  }
}
