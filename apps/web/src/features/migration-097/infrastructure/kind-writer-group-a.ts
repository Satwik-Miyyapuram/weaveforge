import type { Paper, VaultPage } from "@weaveforge/core";
import { ConflictError } from "@weaveforge/core";
import { changeJsonRows, readJsonRows, type JsonRow } from "@/lib/json-rows-file";
import { typedCore } from "@/lib/rust-core";
import type { KindWriter } from "../domain/kind-writer";
import type { FileCodec, FileSink, Row } from "../domain/ports";
import { SERVER_ONLY_FIELDS } from "../domain/server-only-fields";
import { FileNoteRepository } from "../../notes/infrastructure/file-note-repo";
import { FilePaperRepository } from "../../papers/infrastructure/file-paper-repository";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";

const KIND_NAMES = ["notes", "papers", "comments"] as const;

/** Commentable resource types whose files the run's codec writes, by codec kind. */
const CODEC_KIND_OF: Readonly<Record<string, string>> = {
  log_entry: "logEntries",
  report_section: "reportSections",
  reading_list: "readingLists",
};

/** Workspace root: the app keeps papers, notes and their sidecars here (wire-file-backend). */
const ROOT = "";

/** The row without server-only columns and without null or undefined values: what a file repo takes. */
function fileFields(kind: string, row: Row): Row {
  const skip = new Set(SERVER_ONLY_FIELDS[kind] ?? []);
  return Object.fromEntries(Object.entries(row).filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null));
}

/** A vault_pages row as the note the app saves. */
function toPage(row: Row): VaultPage {
  // A canvas body is JSON Canvas text, saved as a .canvas file, never as a .note.md (FileNoteRepository refuses it).
  if (row.kind != null && row.kind !== "note") throw new Error(`a ${String(row.kind)} page is not exported as a note`);
  const page: VaultPage = {
    id: String(row.id),
    title: String(row.title),
    body: typeof row.body === "string" ? row.body : "",
    sortOrder: Number(row.sortOrder ?? 0),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
  if (row.parentId) page.parentId = String(row.parentId);
  if (row.pinned === true) page.pinned = true;
  if (row.folder === true) page.folder = true;
  return page;
}

/**
 * A comments row as the app stores it in the item's sidecar (FileCommentRepository's shape). The app's anchor
 * has three strings, so an absent part is stored as "" and read back as null (fromStored).
 */
function toStored(row: Row, keepItem: boolean): JsonRow {
  const anchored = row.anchorQuote != null || row.anchorPrefix != null || row.anchorSuffix != null;
  return {
    id: String(row.id),
    authorId: String(row.authorId),
    body: String(row.body),
    createdAt: String(row.createdAt),
    ...(anchored
      ? { anchor: { quote: row.anchorQuote ?? "", prefix: row.anchorPrefix ?? "", suffix: row.anchorSuffix ?? "" } }
      : {}),
    ...(row.parentId != null ? { parentId: row.parentId } : {}),
    ...(row.resolvedAt != null ? { resolvedAt: row.resolvedAt } : {}),
    ...(keepItem ? { resourceType: row.resourceType, resourceId: row.resourceId } : {}),
  };
}

/** A stored comment as the server row: the sidecar's item gives resourceType and resourceId. */
function fromStored(stored: JsonRow, item: { resourceType: string; resourceId: string }): Row {
  const anchor = (stored.anchor ?? null) as { quote?: string; prefix?: string; suffix?: string } | null;
  return {
    id: stored.id,
    authorId: stored.authorId,
    resourceType: item.resourceType,
    resourceId: item.resourceId,
    body: stored.body,
    createdAt: stored.createdAt,
    anchorQuote: anchor?.quote || null,
    anchorPrefix: anchor?.prefix || null,
    anchorSuffix: anchor?.suffix || null,
    parentId: stored.parentId ?? null,
    resolvedAt: stored.resolvedAt ?? null,
  };
}

/** Key-order-free text of a JSON value, so a stored row equals the same row written in another key order. */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Group (a) kinds over the app's FILES repos at the workspace root: notes (FileNoteRepository), papers
 * (FilePaperRepository) and comments (the `<item>.comments.json` sidecar next to the item's file, as
 * FileCommentRepository stores it). The item file is the paper or note, or for a log entry, report section or
 * reading list the file `codec` decodes to that id. A comment whose item has no local file (a milestone, or an
 * item not exported) goes to `comments/<resourceType>-<resourceId>.comments.json` and keeps its item ids.
 *
 * readBack lists only the rows this writer wrote, so the user's own local files (a files-first web
 * workspace) never read as extra rows. A local file that already holds a row with other content is never
 * overwritten: notes and papers refuse through their repos' conditional writes, comments throw ConflictError.
 */
export function createGroupAWriter(sink: FileSink, codec?: FileCodec): KindWriter {
  const fs = sinkAsWorkspaceFs(sink);
  const notes = new FileNoteRepository(fs, ROOT);
  const papers = new FilePaperRepository(fs, ROOT);
  // A sidecar takes one comment per write, so it is written several times in one run: compare-and-set, so the
  // guarded sink sees a file this run wrote (ours) and not a differing user file.
  const sidecarFs = sinkAsWorkspaceFs(sink, { compareAndSet: true });
  const written: Record<string, Set<string>> = { notes: new Set(), papers: new Set(), comments: new Set() };
  /** Sidecar path -> the item its comments are on. */
  const sidecars = new Map<string, { resourceType: string; resourceId: string }>();

  const checkKind = (kind: string): void => {
    if (!(KIND_NAMES as readonly string[]).includes(kind)) throw new Error(`unknown kind: ${kind}`);
  };

  /**
   * "codecKind:id" -> its file, built on first use from one read of each .md file outside assets/: the codec
   * kinds are written before comments.
   */
  let codecFiles: Map<string, string> | null = null;
  const codecFileOf = async (kind: string, id: string): Promise<string | null> => {
    if (!codec?.supports(kind)) return null;
    if (!codecFiles) {
      const files = new Map<string, string>();
      const kinds = Object.values(CODEC_KIND_OF).filter((k) => codec.supports(k));
      for (const path of await sink.list()) {
        if (!path.endsWith(".md") || path.startsWith(".weaveforge/") || path.startsWith("assets/")) continue;
        const text = await sink.readText(path);
        for (const k of kinds) {
          try {
            const row = codec.toRow(k, path, text);
            const key = `${k}:${String(row?.id)}`;
            if (row?.id != null && !files.has(key)) files.set(key, path);
          } catch {
            // Not a file of this kind.
          }
        }
      }
      codecFiles = files;
    }
    return codecFiles.get(`${kind}:${id}`) ?? null;
  };

  /** Item -> its file, so many comments on one item scan the files once. A note or paper write clears it. */
  const itemFiles = new Map<string, Promise<string | null>>();
  const itemFile = (resourceType: string, resourceId: string): Promise<string | null> => {
    const key = `${resourceType}:${resourceId}`;
    let found = itemFiles.get(key);
    if (!found) {
      const kind = CODEC_KIND_OF[resourceType];
      if (resourceType === "paper") found = papers.pathOf(resourceId);
      else if (resourceType === "vault_page") found = notes.pathOf(resourceId);
      else found = kind ? codecFileOf(kind, resourceId) : Promise.resolve(null);
      itemFiles.set(key, found);
    }
    return found;
  };

  const writeComment = async (row: Row): Promise<void> => {
    const item = { resourceType: String(row.resourceType), resourceId: String(row.resourceId) };
    const itemPath = await itemFile(item.resourceType, item.resourceId);
    const path = itemPath
      ? typedCore().commentsFilePath(itemPath)
      : `comments/${item.resourceType}-${item.resourceId}.comments.json`;
    const want = toStored(row, itemPath === null);
    const present = (await readJsonRows(sidecarFs, path)).rows.find((r) => r.id === want.id);
    if (present && canon(present) === canon(want)) {
      // Already there as is (a re-run, or the user's own copy): no write, so no file is touched.
      sidecars.set(path, item);
      return;
    }
    await changeJsonRows(sidecarFs, path, (rows) => {
      const have = rows.find((r) => r.id === want.id);
      if (!have) return [...rows, want];
      if (canon(have) !== canon(want)) throw new ConflictError(`${path}: comment ${String(want.id)} differs locally; not overwritten.`);
      return rows;
    });
    sidecars.set(path, item);
  };

  return {
    kinds: [...KIND_NAMES],
    write: async (kind, row) => {
      checkKind(kind);
      if (kind !== "comments") itemFiles.clear();
      if (kind === "notes") await notes.save(toPage(row));
      else if (kind === "papers") await papers.save(fileFields("papers", row) as unknown as Paper);
      else await writeComment(row);
      written[kind]!.add(String(row.id));
    },
    readBack: async (kind) => {
      checkKind(kind);
      const ids = written[kind]!;
      if (kind === "notes") return (await notes.list()).filter((p) => ids.has(p.id)).map((p) => ({ ...p }));
      if (kind === "papers") return (await papers.list()).filter((p) => ids.has(p.id)).map((p) => ({ ...p }));
      const out: Row[] = [];
      for (const [path, item] of sidecars) {
        for (const stored of (await readJsonRows(sidecarFs, path)).rows) {
          if (ids.has(String(stored.id))) out.push(fromStored(stored, item));
        }
      }
      return out;
    },
  };
}
