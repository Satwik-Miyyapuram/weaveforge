import type { KindWriter } from "../domain/kind-writer";
import type { FileCodec, FileSink, Row } from "../domain/ports";
import { createArchiveWriter, type FormatWrite } from "./kind-writer-archive";
import { createGroupAWriter } from "./kind-writer-group-a";
import { createGroupBWriter } from "./kind-writer-group-b";
import { createGroupCWriter } from "./kind-writer-group-c";
import { createPaperFieldsWriter } from "./kind-writer-paper-fields";
import { createTagsWriter } from "./kind-writer-tags";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { FilePaperRelationRepository } from "@/backend/providers/files/file-relation-repo";
import { FileLibraryPinRepository } from "@/backend/providers/files/file-library-pin-repo";
import type { NewLibraryPinInput, PaperRelation } from "@weaveforge/core";

/**
 * Kinds the wasm codec and group (a) do not write: each is archived losslessly (kind-writer-archive), and the
 * archive is what verify reads back. Screening and settings have no file home and are archived only.
 */
export const ARCHIVE_KINDS: readonly string[] = [
  "tags", "paperFields", "paperFieldValues", "relations", "screening", "milestones", "metrics",
  "annotations", "annotationPins", "libraryPins", "settings", "aiProposals",
];

/**
 * Writes each archived row to its files-first home too, all in the workspace root ("" project), where group (a)
 * puts the papers. A row whose parent is missing (an orphan) fails here and stays in the archive only.
 */
function fileFormats(sink: FileSink): FormatWrite {
  // Pins and relations edit paper files group (a) wrote this run: a compare-and-set keeps them ours, not conflict copies.
  const fs = sinkAsWorkspaceFs(sink, { compareAndSet: true });
  const papers = new FilePaperRepository(fs, "");
  const tags = createTagsWriter(sink);
  const fields = createPaperFieldsWriter(sink, new Map());
  const groupB = createGroupBWriter(sink, new Map([["", ""]]));
  const groupC = createGroupCWriter(sink, "");
  const relations = new FilePaperRelationRepository(papers, fs, () => "");
  const pins = new FileLibraryPinRepository(papers);
  const atRoot = (row: Row): Row => ({ ...row, projectId: "" });
  const handlers: Record<string, FormatWrite> = {
    tags: (kind, row) => tags.write(kind, row),
    paperFields: (kind, row) => fields.write(kind, { ...row, projectId: null }),
    paperFieldValues: (kind, row) => fields.write(kind, { ...row, projectId: null }),
    milestones: (kind, row) => groupB.write(kind, atRoot(row)),
    metrics: (kind, row) => groupB.write(kind, atRoot(row)),
    aiProposals: (kind, row) => groupB.write(kind, atRoot(row)),
    annotations: async (kind, row) => {
      if (typeof row.paperId !== "string") throw new Error("annotations: row has no paperId");
      const paperFile = await papers.pathOf(row.paperId);
      if (paperFile === null) throw new Error(`annotations: no paper ${row.paperId}`);
      await groupC.write(kind, { ...row, paperFile });
    },
    annotationPins: (kind, row) => groupC.write(kind, row),
    relations: (_kind, row) => relations.save(row as unknown as PaperRelation),
    libraryPins: async (_kind, row) => {
      await pins.pin(row as unknown as NewLibraryPinInput);
    },
  };
  return async (kind, row) => handlers[kind]?.(kind, row);
}

/** The production kind writers for the 0.9.7 export: group (a) plus the lossless archive for every other kind. */
export function createMigrationWriters(
  sink: FileSink,
  codec: FileCodec,
  onFormatError?: (kind: string, row: Row, err: unknown) => void,
): KindWriter[] {
  return [createGroupAWriter(sink, codec), createArchiveWriter(sink, ARCHIVE_KINDS, fileFormats(sink), onFormatError)];
}
