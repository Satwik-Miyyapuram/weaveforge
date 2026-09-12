/**
 * Where a note's stroke chunks live: the port, and the page loader over it.
 *
 * A chunk is one page's strokes, columnar binary, compressed (§4.3), and it is
 * addressed by the note's id and the chunk's ULID — never by page number, since
 * order is the note's metadata and identity is the file (§4.1). The store knows
 * nothing about pages; `loadInkPages` is what turns the note's declared order
 * plus whatever chunks exist into the page list the host shows.
 *
 * Three stores answer this port: the workspace folder's `.ink/<id>/` directory
 * when one is open, the encrypted blob bucket the vault's assets already use
 * otherwise, and memory for tests. The host cannot tell them apart, which is
 * the point — an ink note is an ink note whether it sits on disk or in Supabase.
 */

import {
  INK_CHUNK_EXT,
  inkChunkPath,
  isInkChunkId,
  newInkChunkId,
  resolveInkPageOrder,
  type InkNoteMeta,
  type InkPaper,
} from "@weaveforge/core";

export interface InkChunkStore {
  /** The chunk's bytes, or `null` where no such chunk exists. */
  read(noteId: string, chunkId: string): Promise<Uint8Array | null>;
  write(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void>;
  remove(noteId: string, chunkId: string): Promise<void>;
  /**
   * The chunk ids the store holds for a note, or `null` where it cannot say.
   *
   * A folder can list its directory; a blob bucket lists by prefix; some stores
   * cannot list at all and answer `null`, in which case the note's declared
   * order is the whole truth.
   */
  list(noteId: string): Promise<string[] | null>;
}

/** One page as the host loads it: its chunk id, its bytes, and its paper. */
export interface InkStoredPage {
  chunkId: string;
  chunk: Uint8Array | null;
  paper: InkPaper;
}

/**
 * The pages of a note, in the note's order, with orphans appended (§4.2).
 *
 * A note with no chunks is a valid one-page empty ink note, and gets a fresh
 * chunk id so its first save has somewhere to go. A declared page whose chunk
 * is missing is kept — empty — rather than dropped, since dropping it would
 * silently renumber the pages after it.
 */
export async function loadInkPages(
  store: InkChunkStore,
  noteId: string,
  meta: InkNoteMeta,
): Promise<InkStoredPage[]> {
  const present = (await store.list(noteId)) ?? [];
  // Declared order is kept even where a chunk is missing — a page that lost
  // its file is an empty page, not a vanished one — then the orphans follow.
  const declared = meta.pageOrder.filter(isInkChunkId);
  const order = [...new Set(declared)];
  for (const id of resolveInkPageOrder(declared, present)) {
    if (!order.includes(id)) order.push(id);
  }
  if (order.length === 0) order.push(newInkChunkId());
  const pages = await Promise.all(
    order.map(async (chunkId) => ({
      chunkId,
      chunk: await store.read(noteId, chunkId).catch(() => null),
      paper: meta.paper,
    })),
  );
  return pages;
}

/** The chunk id a file name carries, or `null` for anything else in the directory. */
export function chunkIdOfFileName(name: string): string | null {
  if (!name.endsWith(INK_CHUNK_EXT)) return null;
  const id = name.slice(0, -INK_CHUNK_EXT.length);
  return isInkChunkId(id) ? id : null;
}

/** A store that forgets on reload. Tests, and the fallback where nothing else is wired. */
export class MemoryInkChunkStore implements InkChunkStore {
  private readonly chunks = new Map<string, Uint8Array>();

  async read(noteId: string, chunkId: string): Promise<Uint8Array | null> {
    return this.chunks.get(inkChunkPath(noteId, chunkId)) ?? null;
  }

  async write(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void> {
    this.chunks.set(inkChunkPath(noteId, chunkId), bytes.slice());
  }

  async remove(noteId: string, chunkId: string): Promise<void> {
    this.chunks.delete(inkChunkPath(noteId, chunkId));
  }

  async list(noteId: string): Promise<string[]> {
    const prefix = inkChunkPath(noteId, newInkChunkId()).replace(/[^/]+$/, "");
    const ids: string[] = [];
    for (const path of this.chunks.keys()) {
      if (!path.startsWith(prefix)) continue;
      const id = chunkIdOfFileName(path.slice(prefix.length));
      if (id) ids.push(id);
    }
    return ids.sort();
  }

  get size(): number {
    return this.chunks.size;
  }
}
