import type {
  IZoteroAnnotationWriteBack,
  ReaderAnnotation,
  ZoteroAnnotationWritePayload,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/**
 * Records what a live Zotero push would send, without sending it. Live
 * write-back needs human-supervised credentials, so `{ live: true }` throws.
 * The payloads come from the Rust core.
 */
export class DryRunZoteroAnnotationWriteBack implements IZoteroAnnotationWriteBack {
  async push(
    parentItemKey: string,
    annotations: readonly ReaderAnnotation[],
    options?: { live?: boolean },
  ): Promise<{ dryRun: boolean; payloads: ZoteroAnnotationWritePayload[] }> {
    if (options?.live) {
      throw new Error(
        "Live Zotero write-back is disabled in DryRunZoteroAnnotationWriteBack — needs human-supervised credentials (R5).",
      );
    }
    const core = readyCore();
    return {
      dryRun: true,
      payloads: core
        .zoteroWriteBackAnnotations(annotations)
        .map((a: ReaderAnnotation) => core.toZoteroWritePayload(a, parentItemKey) as ZoteroAnnotationWritePayload),
    };
  }
}
