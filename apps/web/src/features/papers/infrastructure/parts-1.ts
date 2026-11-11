import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { BucketAssetStore } from "@/lib/parts-1";
import { logToApp } from "@/lib/error-report/app-log";
import type { ProjectContext } from "@/lib/parts-2";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IAnnotationPinRepository,
  IBlobFetcher,
  ICurrentUserProvider,
  IPaperFieldRepository,
} from "@weaveforge/core";
import type { IPaperImageStore } from "../domain/zotero";

// --- paper-image-store ---
const THUMB_MAX_DIM = 640;

/**
 * Paper image storage — private bucket, user-id prefix for RLS.
 *
 * Unlike the other buckets this one keeps a second, smaller copy beside each
 * upload, because the library grid shows every image at once and full-size
 * ones make it crawl.
 */
export class PaperImageStore extends BucketAssetStore implements IPaperImageStore {
  constructor(blobs: IBlobFetcher, session: ICurrentUserProvider) {
    super("paper-images", blobs, session);
  }

  override async upload(paperId: string, blob: Blob, ext: string): Promise<string> {
    const userId = await this.session.requireUserId();
    const base = `${userId}/${paperId}/${crypto.randomUUID()}`;
    const fullPath = `${base}.full.${ext}`;
    await this.blobs.upload(this.bucket, fullPath, blob, blob.type);
    const thumbnail = await makeThumbnail(blob);
    if (thumbnail) {
      // Optional: readers fall back to the full image, which is already
      // stored. Rejecting here would orphan it.
      try {
        await this.blobs.upload(this.bucket, `${base}.thumb.webp`, thumbnail, "image/webp");
      } catch (err) {
        logToApp({ level: "warn", source: "paper-images", message: `Thumbnail upload failed for ${fullPath}`, detail: String(err) });
      }
    }
    return fullPath;
  }

  override async remove(path: string): Promise<void> {
    await super.remove(path);
    const thumbnail = path.replace(/\.full\.[^.]+$/, ".thumb.webp");
    if (thumbnail !== path) await super.remove(thumbnail);
  }
}

async function makeThumbnail(blob: Blob): Promise<Blob | null> {
  if (typeof window === "undefined" || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, THUMB_MAX_DIM / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.76));
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}


// --- annotation-pin and paper-field repositories ---
/*
 * Through the Rust step engine (`crates/wf-core/src/repos/annotation_pins.rs`,
 * `paper_fields.rs`): Rust plans the queries and maps the rows. Writes stamp the
 * signed-in user, so both take the session.
 */

/** `annotation_pins`, scoped to the open project. */
export function rustAnnotationPinRepository(
  db: SupabaseClient,
  project: ProjectContext,
  session: ICurrentUserProvider,
): IAnnotationPinRepository {
  return rustRepository<IAnnotationPinRepository>(
    db,
    "annotation_pins",
    ["save", "remove", "listForProject", "listForPaper", "listForSection"],
    projectUserCtx(project, session),
  );
}

/** `paper_field_defs` and `paper_field_values`, scoped to the open project. */
export function rustPaperFieldRepository(
  db: SupabaseClient,
  project: ProjectContext,
  session: ICurrentUserProvider,
): IPaperFieldRepository {
  return rustRepository<IPaperFieldRepository>(
    db,
    "paper_fields",
    ["listDefs", "saveDef", "deleteDef", "listValuesForPaper", "listValuesForProject", "setValue", "removeValue"],
    projectUserCtx(project, session),
  );
}
