import type { CitationAlertTrack, IWorkspaceFs, NewLibraryPinInput, PaperRelation, ReadingListItem } from "@weaveforge/core";
import type { KindWriter } from "../domain/kind-writer";
import type { FileCodec, FileSink, Row } from "../domain/ports";
import { createArchiveWriter, type AppFormat } from "./kind-writer-archive";
import { createGroupAWriter } from "./kind-writer-group-a";
import { createGroupBWriter } from "./kind-writer-group-b";
import { createGroupCWriter } from "./kind-writer-group-c";
import { createPaperFieldsWriter } from "./kind-writer-paper-fields";
import { createTagsWriter } from "./kind-writer-tags";
import { createProjectRouter, type ProjectRouter } from "./project-router";
import { scopeSink } from "./scope-sink";
import { loadSettingsDoc, settingsSection, updateSettingsDoc } from "./settings-json-doc";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { FilePaperRelationRepository } from "@/backend/providers/files/file-relation-repo";
import { FileLibraryPinRepository } from "@/backend/providers/files/file-library-pin-repo";
import { FileCitationAlertTrackRepository } from "@/backend/providers/files/file-citation-alert-track-repo";
import { FileReadingListItemRepository } from "@/backend/providers/files/file-reading-list-repo";
import { WorkspaceListFilesPort } from "@/features/reading-lists/infrastructure/shell-list-files-port";
import { readyCore } from "@/lib/rust-core";

/**
 * Kinds the wasm codec and group (a) do not write: each is written to its app file and also archived
 * (kind-writer-archive). Only a row whose app write fails (an orphan) is answered from the archive.
 */
export const ARCHIVE_KINDS: readonly string[] = [
  "tags", "paperFields", "paperFieldValues", "relations", "readingListItems", "screening", "milestones", "metrics",
  "annotations", "annotationPins", "libraryPins", "quotationTypes", "citationAlerts", "settings", "aiProposals",
];

/** One project folder's app repositories, over the sink scoped to that folder. */
type Home = {
  sink: FileSink;
  fs: IWorkspaceFs;
  papers: FilePaperRepository;
  tags: KindWriter;
  fields: KindWriter;
  groupB: KindWriter;
  groupC: KindWriter;
};

/** A kind's app file, written and read back inside one Home. */
type KindFormat = { write(home: Home, row: Row): Promise<void>; readBack(home: Home): Promise<Row[]> };

function openHome(sink: FileSink): Home {
  // Pins and relations edit paper files group (a) wrote this run: a compare-and-set keeps them ours, not conflict copies.
  const fs = sinkAsWorkspaceFs(sink, { compareAndSet: true, cacheReads: true });
  return {
    sink,
    fs,
    papers: new FilePaperRepository(fs, ""),
    tags: createTagsWriter(sink),
    fields: createPaperFieldsWriter(sink, new Map()),
    groupB: createGroupBWriter(sink, new Map([["", ""]])),
    groupC: createGroupCWriter(sink, ""),
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const defined = (row: Row): Row => Object.fromEntries(Object.entries(row).filter(([, v]) => v != null));
const noRoot = () => "";

/**
 * A kind one of the existing writers keeps; `at` rewrites the row's project to the home's own, and
 * readBack puts the DB project back so verify compares like with like.
 */
function delegate(pick: (home: Home) => KindWriter, kind: string, at?: (row: Row) => Row): KindFormat {
  const projectOf = new Map<string, unknown>();
  return {
    write: (home, row) => {
      if (at && row.id != null) projectOf.set(String(row.id), row.projectId);
      return pick(home).write(kind, at ? at(row) : row);
    },
    readBack: async (home) =>
      (await pick(home).readBack(kind)).map((r) =>
        r.id != null && projectOf.has(String(r.id)) ? { ...r, projectId: projectOf.get(String(r.id)) } : r,
      ),
  };
}

/** Tags: the file keys a tag by its normalized name; readBack answers with the DB id and name. */
function tagFormat(): KindFormat {
  const byName = new Map<string, Row>();
  const keyOf = (name: unknown) => readyCore().normalizeTags([String(name)])[0];
  return {
    write: (home, row) => {
      const key = keyOf(row.name);
      if (key !== undefined) byName.set(key, row);
      return home.tags.write("tags", row);
    },
    readBack: async (home) =>
      (await home.tags.readBack("tags")).flatMap((t) => {
        const db = byName.get(String(t.id));
        return db ? [{ id: db.id, name: db.name, color: t.color ?? null }] : [];
      }),
  };
}
const atRoot = (row: Row): Row => ({ ...row, projectId: "" });
const noProject = (row: Row): Row => ({ ...row, projectId: null });

/** user_settings columns as the app keys them in the root settings.json (file-settings-repos.ts). */
function writeSettings(doc: Record<string, unknown>, row: Row): void {
  const s = settingsSection(doc);
  if (row.zoteroLibrary != null) s.set(["zoteroLibrary"], row.zoteroLibrary);
  if (row.disclaimerAcceptedAt != null) {
    s.set(["disclaimer"], defined({ acceptedAt: row.disclaimerAcceptedAt, version: row.disclaimerVersion }));
  }
  if (row.appearance != null) s.set(["appearance"], row.appearance);
  if (row.aiAccess != null) s.set(["aiAccess"], row.aiAccess);
  if (row.lastReleaseNoticeSeen != null) s.set(["releaseNoticeSeen"], row.lastReleaseNoticeSeen);
}

function readSettings(doc: Record<string, unknown>): Row {
  const disclaimer = (doc.disclaimer ?? {}) as Row;
  return defined({
    zoteroLibrary: doc.zoteroLibrary,
    disclaimerAcceptedAt: disclaimer.acceptedAt,
    disclaimerVersion: disclaimer.version,
    appearance: doc.appearance,
    aiAccess: doc.aiAccess,
    lastReleaseNoticeSeen: doc.releaseNoticeSeen,
  });
}

/** Items and decisions this run wrote: screening names its paper by item, verify names the item by decision. */
type ListState = {
  items: Map<string, { listId: string; paperId?: string }>;
  decisions: Map<string, { itemId: string; paperId: string }>;
};

/** The list file whose id is `listId`, in this home. */
async function listFileOf(port: WorkspaceListFilesPort, listId: string) {
  for (const file of await port.listFiles()) {
    if (readyCore().entityRowFromFile("reading_list", file.text)?.id === listId) return file;
  }
  return null;
}

function formats(lists: ListState): Record<string, KindFormat> {
  return {
    tags: tagFormat(),
    paperFields: delegate((h) => h.fields, "paperFields", noProject),
    paperFieldValues: delegate((h) => h.fields, "paperFieldValues", noProject),
    milestones: delegate((h) => h.groupB, "milestones", atRoot),
    metrics: delegate((h) => h.groupB, "metrics", atRoot),
    aiProposals: delegate((h) => h.groupB, "aiProposals", atRoot),
    annotationPins: delegate((h) => h.groupC, "annotationPins"),
    annotations: {
      async write(home, row) {
        const paperId = str(row.paperId);
        if (!paperId) throw new Error("annotations: row has no paperId");
        const paperFile = await home.papers.pathOf(paperId);
        if (paperFile === null) throw new Error(`annotations: no paper ${paperId}`);
        await home.groupC.write("annotations", { ...row, paperFile });
      },
      readBack: (home) => home.groupC.readBack("annotations"),
    },
    relations: {
      write: (home, row) => new FilePaperRelationRepository(home.papers, home.fs, noRoot).save(row as unknown as PaperRelation),
      readBack: async (home) =>
        (await new FilePaperRelationRepository(home.papers, home.fs, noRoot).list()).map((r) => ({
          fromPaper: r.fromPaper, toPaper: r.toPaper, relation: r.relation, note: r.note ?? null, source: r.source ?? null,
        })),
    },
    libraryPins: {
      async write(home, row) {
        await new FileLibraryPinRepository(home.papers, home.fs).pin(row as unknown as NewLibraryPinInput);
      },
      readBack: async (home) =>
        (await new FileLibraryPinRepository(home.papers, home.fs).listForProject()).map((p) => ({
          resourceType: p.resourceType, resourceId: p.resourceId,
        })),
    },
    citationAlerts: {
      write: (home, row) =>
        updateSettingsDoc(home.sink, "citationAlerts", (doc) =>
          new FileCitationAlertTrackRepository(settingsSection(doc)).save({
            ...(row as unknown as CitationAlertTrack),
            lastCheckedAt: str(row.lastCheckedAt),
            seenCitingIds: (row.seenCitingIds as string[] | null) ?? [],
          }),
        ),
      readBack: async (home) => {
        const doc = await loadSettingsDoc(home.sink, "citationAlerts");
        return (await new FileCitationAlertTrackRepository(settingsSection(doc)).listForProject()).map((t) => defined({ ...t }));
      },
    },
    quotationTypes: {
      write: (home, row) =>
        updateSettingsDoc(home.sink, "quotationTypes", (doc) =>
          settingsSection(doc).set(["quotationTypes", String(row.paperId), String(row.annotationKey)], {
            type: row.quotationType, createdAt: row.createdAt, updatedAt: row.updatedAt,
          }),
        ),
      readBack: async (home) => {
        const all = ((await loadSettingsDoc(home.sink, "quotationTypes")).quotationTypes ?? {}) as Record<string, Record<string, Row>>;
        return Object.entries(all).flatMap(([paperId, keys]) =>
          Object.entries(keys).map(([annotationKey, v]) => ({
            paperId, annotationKey, quotationType: v.type, createdAt: v.createdAt, updatedAt: v.updatedAt,
          })),
        );
      },
    },
    settings: {
      write: (home, row) => updateSettingsDoc(home.sink, "settings", (doc) => writeSettings(doc, row)),
      readBack: async (home) => [readSettings(await loadSettingsDoc(home.sink, "settings"))],
    },
    readingListItems: {
      async write(home, row) {
        await new FileReadingListItemRepository(home.fs, noRoot).add(row as unknown as ReadingListItem);
        lists.items.set(String(row.id), { listId: String(row.listId), paperId: str(row.paperId) });
      },
      readBack: async (home) => {
        const listIds = [...new Set([...lists.items.values()].map((i) => i.listId))];
        return (await new FileReadingListItemRepository(home.fs, noRoot).listItemsForLists(listIds)).map((i) =>
          defined({ listId: i.listId, paperId: i.paperId, vaultPageId: i.vaultPageId, note: i.note }),
        );
      },
    },
    screening: {
      // A decision is a line in its list's file that names the paper by its note link (file-screening-repository.ts).
      async write(home, row) {
        const item = lists.items.get(String(row.itemId));
        if (!item?.paperId) throw new Error("screening: the decision's item has no paper");
        const port = new WorkspaceListFilesPort(home.fs, "");
        const link = await port.linkForItem(item.paperId);
        if (!link) throw new Error("screening: the item's paper has no file");
        const file = await listFileOf(port, item.listId);
        if (!file) throw new Error("screening: the item's list has no file");
        const decision = defined({
          id: row.id, itemId: link, reviewerId: row.reviewerId, stage: row.stage, state: row.state,
          reason: row.reason, decidedAt: row.decidedAt,
        });
        await port.write(file.path, readyCore().recordInListFile(file.text, decision as never), file.hash);
        lists.decisions.set(String(row.id), { itemId: String(row.itemId), paperId: item.paperId });
      },
      readBack: async (home) => {
        const port = new WorkspaceListFilesPort(home.fs, "");
        const out: Row[] = [];
        for (const file of await port.listFiles()) {
          for (const d of readyCore().screeningInListFile(file.text) as unknown as Row[]) {
            const ours = lists.decisions.get(String(d.id));
            if (!ours || (await port.itemForLink(String(d.itemId))) !== ours.paperId) continue;
            out.push(defined({ ...d, itemId: ours.itemId }));
          }
        }
        return out;
      },
    },
  };
}

/**
 * Writes each archived row to its app file in its project's folder (router), through the app's own
 * repositories. Tags go to every project; settings, quotation types and AI proposals to the root.
 * A row whose parent is missing (an orphan) fails here and stays in the archive only.
 */
function appFormat(sink: FileSink, router: ProjectRouter): AppFormat {
  const homes = new Map<string, Home>();
  const homeAt = (folder: string): Home =>
    homes.get(folder) ?? homes.set(folder, openHome(scopeSink(sink, folder))).get(folder)!;
  const used = new Map<string, Set<string>>();
  const byKind = formats({ items: new Map(), decisions: new Map() });
  return {
    async write(kind, row) {
      const format = byKind[kind];
      if (!format) return;
      for (const folder of kind === "tags" ? router.folders : [router.folderOf(kind, row)]) {
        (used.get(kind) ?? used.set(kind, new Set()).get(kind)!).add(folder);
        await format.write(homeAt(folder), row);
      }
    },
    async readBack(kind) {
      const format = byKind[kind];
      if (!format) return [];
      const rows: Row[] = [];
      for (const folder of used.get(kind) ?? []) rows.push(...(await format.readBack(homeAt(folder))));
      // A tag sits in every project's settings: one row per tag.
      return kind === "tags" ? [...new Map(rows.map((r) => [String(r.id), r])).values()] : rows;
    },
  };
}

/** Group (a) with one writer per project folder, each over the sink scoped to its folder. */
function routedGroupA(sink: FileSink, codec: FileCodec, router: ProjectRouter): KindWriter {
  const writers = new Map<string, KindWriter>();
  const at = (folder: string): KindWriter =>
    writers.get(folder) ?? writers.set(folder, createGroupAWriter(scopeSink(sink, folder), codec)).get(folder)!;
  const root = at("");
  return {
    kinds: root.kinds,
    write: (kind, row) => at(router.folderOf(kind, row)).write(kind, row),
    async readBack(kind) {
      const rows: Row[] = [];
      for (const writer of writers.values()) rows.push(...(await writer.readBack(kind)));
      return rows;
    },
    ...(root.archivedOnly && { archivedOnly: () => [...writers.values()].flatMap((w) => w.archivedOnly?.() ?? []) }),
  };
}

/** The production kind writers for the 0.9.7 export: group (a) plus the archive-backed app writers, per project. */
export function createMigrationWriters(
  sink: FileSink,
  codec: FileCodec,
  router: ProjectRouter = createProjectRouter([]),
  onFormatError?: (kind: string, row: Row, err: unknown) => void,
): KindWriter[] {
  return [routedGroupA(sink, codec, router), createArchiveWriter(sink, ARCHIVE_KINDS, appFormat(sink, router), onFormatError)];
}
