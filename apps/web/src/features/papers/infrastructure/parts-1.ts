import {
  oneRow,
  ProjectScopedPostgrestRepository,
  rows,
  run,
} from "@/backend/providers/postgrest/parts-1";
import { BucketAssetStore } from "@/lib/parts-1";
import { logToApp } from "@/lib/error-report/app-log";
import { readyCore, typedCore } from "@/lib/rust-core";
import type {
  AnnotationPin,
  IAnnotationPinRepository,
  IBlobFetcher,
  ICurrentUserProvider,
  IPaperFieldRepository,
  PaperFieldDef,
  PaperFieldValue,
  PaperFieldValueData,
  SaveAnnotationPinInput,
  SetPaperFieldValueInput,
} from "@weaveforge/core";
import type {
  AnnotationPinRow,
  PaperFieldDefRow as DefRow,
  PaperFieldValueRow as ValueRow,
} from "@weaveforge/wasm";
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

// --- postgrest-annotation-pin-repository ---
/**
 * The columns a AnnotationPinRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const ANNOTATION_PIN_COLUMNS = "id,paper_id,annotation_key,report_section_id,created_at";

const TABLE = "annotation_pins";

export class PostgrestAnnotationPinRepository extends ProjectScopedPostgrestRepository implements IAnnotationPinRepository {
  protected readonly action = "managing annotation pins";

  async save(input: SaveAnnotationPinInput): Promise<AnnotationPin> {
    const userId = await this.session.requireUserId();
    const dbRow = await oneRow<AnnotationPinRow>(this.db
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          project_id: this.projectId,
          paper_id: input.paperId,
          annotation_key: input.annotationKey,
          report_section_id: input.reportSectionId,
        },
        { onConflict: "project_id,paper_id,annotation_key" },
      )
      .select(ANNOTATION_PIN_COLUMNS)
      .single());
    return readyCore().annotationPinToDomain(dbRow);
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    await run(this.db
      .from(TABLE)
      .delete()
      .eq("project_id", this.projectId)
      .eq("paper_id", paperId)
      .eq("annotation_key", annotationKey));
  }

  listForProject(): Promise<AnnotationPin[]> {
    return this.list();
  }

  listForPaper(paperId: string): Promise<AnnotationPin[]> {
    return this.list({ paperId });
  }

  listForSection(reportSectionId: string): Promise<AnnotationPin[]> {
    return this.list({ reportSectionId });
  }

  private async list(filter?: {
    paperId?: string;
    reportSectionId?: string;
  }): Promise<AnnotationPin[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    let query = this.db.from(TABLE).select(ANNOTATION_PIN_COLUMNS).eq("project_id", projectId);
    if (filter?.paperId) query = query.eq("paper_id", filter.paperId);
    if (filter?.reportSectionId) {
      query = query.eq("report_section_id", filter.reportSectionId);
    }
    return (await rows<AnnotationPinRow>(query.order("created_at", { ascending: true }))).map((row) => readyCore().annotationPinToDomain(row));
  }
}

// --- postgrest-paper-field-repository ---
// Row mapping runs in the Rust core (wf-core `papers::paper_field_row`).
const toDef = (row: DefRow): PaperFieldDef => {
  const def = typedCore().paperFieldDefRowToDomain(row);
  return { ...def, sortOrder: def.sortOrder ?? 0 };
};
const toValue = (row: ValueRow): PaperFieldValue => {
  const val = typedCore().paperFieldValueRowToDomain(row);
  // Bindings type f64 as number | null (NaN/Infinity serialise as null); field values are always finite.
  return { ...val, value: val.value as PaperFieldValueData };
};

const DEFS = "paper_field_defs";
const VALUES = "paper_field_values";

export class PostgrestPaperFieldRepository extends ProjectScopedPostgrestRepository implements IPaperFieldRepository {
  protected readonly action = "managing paper fields";

  async listDefs(): Promise<PaperFieldDef[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    return (await rows<DefRow>(this.db
      .from(DEFS)
      .select("id, name, kind, options, sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }))).map(toDef);
  }

  async saveDef(def: PaperFieldDef): Promise<void> {
    const userId = await this.session.requireUserId();
    await run(this.db.from(DEFS).upsert(
      {
        id: def.id,
        user_id: userId,
        project_id: this.projectId,
        name: def.name,
        kind: def.kind,
        options: def.options,
        sort_order: def.sortOrder,
      },
      { onConflict: "id" },
    ));
  }

  async deleteDef(id: string): Promise<void> {
    await run(this.db
      .from(DEFS)
      .delete()
      .eq("project_id", this.projectId)
      .eq("id", id));
  }

  listValuesForPaper(paperId: string): Promise<PaperFieldValue[]> {
    return this.listValues(paperId);
  }

  listValuesForProject(): Promise<PaperFieldValue[]> {
    return this.listValues();
  }

  async setValue(input: SetPaperFieldValueInput): Promise<PaperFieldValue> {
    const userId = await this.session.requireUserId();
    const dbRow = await oneRow<ValueRow>(this.db
      .from(VALUES)
      .upsert(
        {
          user_id: userId,
          project_id: this.projectId,
          paper_id: input.paperId,
          field_id: input.fieldId,
          value: input.value,
        },
        { onConflict: "project_id,paper_id,field_id" },
      )
      .select("id, paper_id, field_id, value")
      .single());
    return toValue(dbRow);
  }

  async removeValue(paperId: string, fieldId: string): Promise<void> {
    await run(this.db
      .from(VALUES)
      .delete()
      .eq("project_id", this.projectId)
      .eq("paper_id", paperId)
      .eq("field_id", fieldId));
  }

  private async listValues(paperId?: string): Promise<PaperFieldValue[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    let query = this.db
      .from(VALUES)
      .select("id, paper_id, field_id, value")
      .eq("project_id", projectId);
    if (paperId) query = query.eq("paper_id", paperId);
    return (await rows<ValueRow>(query
      .order("paper_id", { ascending: true })
      .order("field_id", { ascending: true }))).map(toValue);
  }
}
