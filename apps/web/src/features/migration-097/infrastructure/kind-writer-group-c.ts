import { ConflictError, type NewReaderAnnotation } from "@weaveforge/core";
import type { KindWriter } from "../domain/kind-writer";
import type { FileSink, Row } from "../domain/ports";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";
import { FileReaderAnnotationRepository } from "@/features/reader/infrastructure/file-annotation-repository";
import { FileAnnotationPinRepository } from "@/features/papers/infrastructure/file-annotation-pin-repository";
import { FileBlobStore } from "@/backend/providers/files/file-blob-store";
import { FolderInkNotes, FsInkChunkStore } from "@/features/ink/infrastructure/parts";
import { typedCore } from "@/lib/rust-core";

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
/** True when an on-disk annotation already holds the row's carried fields (a re-run of the same row). */
function sameAnnotation(existing: object, row: Record<string, unknown>): boolean {
  const pick = (o: Record<string, unknown>) =>
    JSON.stringify([o.type, o.color, o.text, o.comment ?? "", o.tags ?? [], o.anchor ?? null, o.sortIndex, Number(o.pageIndex ?? (o.anchor as { pageIndex?: number } | null)?.pageIndex ?? 0)]);
  return pick(existing as Record<string, unknown>) === pick(row);
}

export function createGroupCWriter(sink: FileSink, projectRoot: string): KindWriter {
  const fs = sinkAsWorkspaceFs(sink);

  // Gap: `paperFile` (the paper's workspace path) is not a PostgREST column; the exporter must supply it.
  const paperFiles = new Map<string, string>();
  // The sidecar path of each paper written in this run, to name its paper on readBack.
  const paperOfSidecar = new Map<string, string>();
  const annotations = new FileReaderAnnotationRepository(fs, projectRoot, async (paperId) => paperFiles.get(paperId) ?? null);
  const pins = new FileAnnotationPinRepository(fs, projectRoot);
  const blobs = new FileBlobStore(fs);
  const ink = new FsInkChunkStore(() => fs, new FolderInkNotes(() => fs));

  // Notes written in this run: readBack lists each one's chunks from the .inkb store on disk.
  const inkNotes = new Set<string>();

  const handlers = new Map<string, KindHandler>([
    [
      "annotations",
      {
        async write(row) {
          const paperId = String(row.paperId);
          if (typeof row.paperFile !== "string" || row.paperFile === "") {
            throw new Error(`annotations: paperFile missing for paper ${paperId}`);
          }
          const paperFile = row.paperFile;
          paperFiles.set(paperId, paperFile);
          paperOfSidecar.set(typedCore().annotationsFilePath(paperFile), paperId);
          // Re-run: the same row on disk is a no-op; the same id with other content is a conflict, never a silent skip.
          const existing = (await annotations.list(paperId)).find((a) => a.id === (row.id as string));
          if (existing) {
            if (sameAnnotation(existing, row)) return;
            throw new ConflictError(`conflict: annotation ${String(row.id)} on paper ${paperId} exists with different content`);
          }
          const draft: NewReaderAnnotation & { createdAt?: string; updatedAt?: string } = {
            id: row.id as string,
            type: row.type as NewReaderAnnotation["type"],
            color: String(row.color),
            text: row.text as string,
            comment: row.comment as string,
            tags: row.tags as string[],
            anchor: row.anchor as NewReaderAnnotation["anchor"],
            sortIndex: row.sortIndex as string,
            pageIndex: Number(row.pageIndex ?? 0),
            createdAt: row.createdAt as string | undefined,
            updatedAt: row.updatedAt as string | undefined,
          };
          await annotations.create(paperId, draft);
        },
        // Lists every sidecar under the paper folder, so a file written outside this run is listed too.
        // A sidecar this run did not write has no known paper; its rows carry paperId null and fail verify.
        async readBack() {
          const out: Row[] = [];
          const dir = typedCore().entityDir("paper", projectRoot);
          if (!(await fs.stat(dir))) return out;
          for await (const entry of fs.walk(dir)) {
            if (!entry.path.endsWith(".annotations.json")) continue;
            const rows = typedCore().parseAnnotationsFile(await fs.readText(entry.path));
            const paperId = paperOfSidecar.get(entry.path) ?? null;
            // The DB column page_index is top-level, but a file row keeps pageIndex only inside its anchor.
            for (const row of rows) {
              const anchorPage = (row.anchor as { pageIndex?: number } | null | undefined)?.pageIndex;
              out.push({ ...row, paperId, pageIndex: Number(anchorPage ?? 0) });
            }
          }
          return out;
        },
      },
    ],
    [
      "annotationPins",
      {
        async write(row) {
          await pins.save({
            id: row.id === undefined ? undefined : String(row.id),
            paperId: String(row.paperId),
            annotationKey: String(row.annotationKey),
            reportSectionId: String(row.reportSectionId),
            createdAt: row.createdAt === undefined ? undefined : String(row.createdAt),
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
          // FileBlobStore writes this type to the `.sha256` sidecar's line 2. The web export's sidecar holds the sha256 alone (061ff182f).
          const contentType = row.contentType ? String(row.contentType) : "application/octet-stream";
          await blobs.upload(bucket, path, new Blob([new Uint8Array(bytes)]), contentType);
        },
        // Scans assets/ on disk, so a blob written by an earlier run is listed too. Each file is
        // checked against its own sidecar: sha256 on line 1 (a line 2 is read if present). A .part file is
        // an interrupted write, and an asset with no sidecar is left out: its entry then reads as
        // missing, and the other blobs still read back.
        async readBack() {
          const out: Row[] = [];
          if (!(await fs.stat("assets"))) return out;
          for await (const entry of fs.walk("assets")) {
            if (entry.path.endsWith(".sha256") || entry.path.endsWith(".part")) continue;
            if (!(await fs.stat(`${entry.path}.sha256`))) continue;
            const rel = entry.path.slice("assets/".length);
            const slash = rel.indexOf("/");
            const bucket = rel.slice(0, slash);
            const path = rel.slice(slash + 1);
            const bytes = await fs.readFile(entry.path);
            const [sha256, type] = (await fs.readText(`${entry.path}.sha256`)).split("\n");
            // A blob that no longer matches its sidecar is left out, so its entry reads as missing; the others still read back.
            if ((await sha256Hex(bytes)) !== sha256) continue;
            out.push({ bucket, path, sha256, contentType: type || "application/octet-stream" });
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
          inkNotes.add(note);
        },
        // Lists each note's chunks from the .inkb store on disk, so a chunk from an earlier run is listed too.
        async readBack() {
          const out: Row[] = [];
          for (const note of inkNotes) {
            const chunkIds = await ink.list(note);
            if (chunkIds === null) throw new Error(`ink: note ${note} not found on read-back`);
            for (const chunkId of chunkIds) {
              const bytes = await ink.read(note, chunkId);
              if (!bytes) throw new Error(`ink: chunk ${chunkId} of ${note} not found on read-back`);
              out.push({ note, chunkId, bytes });
            }
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
