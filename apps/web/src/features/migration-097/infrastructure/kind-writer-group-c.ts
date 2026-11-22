import type { NewReaderAnnotation } from "@weaveforge/core";
import type { KindWriter } from "../domain/kind-writer";
import type { FileSink, Row } from "../domain/ports";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";
import { FileReaderAnnotationRepository } from "@/features/reader/infrastructure/file-annotation-repository";
import { FileAnnotationPinRepository } from "@/features/papers/infrastructure/file-annotation-pin-repository";
import { FileBlobStore } from "@/backend/providers/files/file-blob-store";
import { FolderInkNotes, FsInkChunkStore } from "@/features/ink/infrastructure/parts";

interface KindHandler {
  write(row: Row): Promise<void>;
  readBack(): Promise<Row[]>;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Group (c) writer: annotations, annotationPins, blobs and ink, each through its
 * FILES repo over the sink. `readBack` lists what this writer has written, so
 * the verify gate compares those rows with the server rows.
 */
export function createGroupCWriter(sink: FileSink, projectRoot: string): KindWriter {
  const fs = sinkAsWorkspaceFs(sink);

  // Gap: `paperFile` (the paper's workspace path) is not a PostgREST column; the exporter must supply it.
  const paperFiles = new Map<string, string>();
  const annotations = new FileReaderAnnotationRepository(fs, projectRoot, async (paperId) => paperFiles.get(paperId) ?? null);
  const pins = new FileAnnotationPinRepository(fs, projectRoot);
  const blobs = new FileBlobStore(fs);
  const ink = new FsInkChunkStore(() => fs, new FolderInkNotes(() => fs));

  const blobRefs: Array<{ bucket: string; path: string; sha256: string; contentType: string }> = [];
  const inkChunks: Array<{ note: string; chunkId: string }> = [];

  const handlers = new Map<string, KindHandler>([
    [
      "annotations",
      {
        async write(row) {
          const paperId = String(row.paperId);
          paperFiles.set(paperId, String(row.paperFile));
          // Idempotent re-run: a row already on disk is not created again (create would throw ConflictError).
          // Gap: create() mints createdAt/updatedAt, so server timestamps are not kept; needs a repo change.
          if ((await annotations.list(paperId)).some((a) => a.id === (row.id as string))) return;
          const draft: NewReaderAnnotation = {
            id: row.id as string,
            type: row.type as NewReaderAnnotation["type"],
            color: String(row.color),
            text: row.text as string,
            comment: row.comment as string,
            tags: row.tags as string[],
            anchor: row.anchor as NewReaderAnnotation["anchor"],
            sortIndex: row.sortIndex as string,
            pageIndex: Number(row.pageIndex ?? 0),
          };
          await annotations.create(paperId, draft);
        },
        async readBack() {
          const out: Row[] = [];
          for (const paperId of paperFiles.keys()) {
            for (const annotation of await annotations.list(paperId)) {
              out.push({ ...annotation, paperId });
            }
          }
          return out;
        },
      },
    ],
    [
      "annotationPins",
      {
        // Gap: save() always mints its own id and createdAt; the row's id and createdAt are not kept.
        async write(row) {
          await pins.save({
            paperId: String(row.paperId),
            annotationKey: String(row.annotationKey),
            reportSectionId: String(row.reportSectionId),
          });
        },
        async readBack() {
          return (await pins.listForProject()) as unknown as Row[];
        },
      },
    ],
    [
      "blobs",
      {
        async write(row) {
          const bucket = String(row.bucket);
          const path = String(row.path);
          const sha256 = String(row.sha256);
          const bytes = row.bytes as Uint8Array;
          if ((await sha256Hex(bytes)) !== sha256) {
            throw new Error(`blobs: sha256 mismatch for ${bucket}/${path}`);
          }
          // The type goes into the existing `.sha256` sidecar (line 2) via upload's contentType.
          const contentType = row.contentType ? String(row.contentType) : "application/octet-stream";
          await blobs.upload(bucket, path, new Blob([new Uint8Array(bytes)]), contentType);
          blobRefs.push({ bucket, path, sha256, contentType });
        },
        async readBack() {
          const out: Row[] = [];
          for (const ref of blobRefs) {
            const blob = await blobs.fetchBlob(ref.bucket, ref.path);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            if ((await sha256Hex(bytes)) !== ref.sha256) {
              throw new Error(`blobs: read-back sha256 mismatch for ${ref.bucket}/${ref.path}`);
            }
            out.push({ bucket: ref.bucket, path: ref.path, sha256: ref.sha256, contentType: blob.type });
          }
          return out;
        },
      },
    ],
    [
      "ink",
      {
        async write(row) {
          const note = String(row.note);
          const chunkId = String(row.chunkId);
          await ink.write(note, chunkId, row.bytes as Uint8Array);
          inkChunks.push({ note, chunkId });
        },
        async readBack() {
          const out: Row[] = [];
          for (const { note, chunkId } of inkChunks) {
            const bytes = await ink.read(note, chunkId);
            if (!bytes) throw new Error(`ink: chunk ${chunkId} of ${note} not found on read-back`);
            out.push({ note, chunkId, bytes });
          }
          return out;
        },
      },
    ],
  ]);

  function handlerFor(kind: string): KindHandler {
    const handler = handlers.get(kind);
    if (!handler) throw new Error(`unknown kind: ${kind}`);
    return handler;
  }

  return {
    kinds: [...handlers.keys()],
    async write(kind, row) {
      await handlerFor(kind).write(row);
    },
    async readBack(kind) {
      return handlerFor(kind).readBack();
    },
  };
}
