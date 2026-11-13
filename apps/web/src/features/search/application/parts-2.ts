import { readyCore, type RustCore } from "@/lib/rust-core";
import type { SearchDoc } from "@weaveforge/core";
import type { IEmbedder } from "./parts";

// --- semantic-index ---
/** A nearest-neighbour hit: a passage or document id and its cosine. */
export interface VectorHit {
  id: string;
  score: number;
}

/** The Rust `VectorIndex` handle, as the wasm factory returns it. */
type VectorIndexHandle = ReturnType<RustCore["createVectorIndex"]>;

/** Flatten equal-width vectors into the one buffer the wasm `add` takes. */
function flatten(vectors: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(vectors.reduce((n, vector) => n + vector.length, 0));
  let at = 0;
  for (const vector of vectors) {
    out.set(vector, at);
    at += vector.length;
  }
  return out;
}

/**
 * The semantic half of search.
 *
 * Separate from `WorkspaceSearch` on purpose: the keyword index is always
 * there, and this is optional, expensive to build, and allowed to fail. Keeping
 * them apart means a browser that cannot run the encoder — or a user who never
 * turns it on — takes no code path through here at all.
 *
 * Documents are embedded as passages, not whole. A note longer than the
 * encoder's window would otherwise be represented by its first paragraph, which
 * looks indexed and is not. Passage ids carry their parent so hits collapse
 * back to documents.
 */

/** Passages embedded per forward pass. Larger batches amortize, up to memory. */
const BATCH = 16;

/** Above this a document is worth splitting; below it the whole thing is one passage. */
const CHUNK_CHARS = 1_000;

export interface EmbedProgress {
  done: number;
  total: number;
  /** Bytes of model weights fetched, before any passage is embedded. */
  download?: { loaded: number; total: number };
}

export interface SemanticBuildOptions {
  onProgress?(progress: EmbedProgress): void;
  /** Now and then mid-build, the finished documents so far; storing them makes the build resumable. */
  onCheckpoint?(partial: PackedIndex): void;
  signal?: AbortSignal;
}

export type SyncOptions = Pick<SemanticBuildOptions, "onProgress" | "onCheckpoint">;

const CHECKPOINT_MS = 30_000;

export interface PackedIndex {
  model: string;
  dimensions: number;
  /** The Rust index's own blob: width, ids and vectors in one self-describing buffer. */
  bytes: Uint8Array;
  hashes: Record<string, string>;
}

const embeddableText = (doc: SearchDoc): string => readyCore().embeddableText(doc.title, doc.aliases, doc.body);
const hashOf = (doc: SearchDoc): string => readyCore().textHash(embeddableText(doc));

export class SemanticIndex {
  private index: VectorIndexHandle | null = null;
  private embedderId = "";
  /**
   * A hash of the text each document was embedded from, by document id.
   *
   * What lets `sync` re-embed only what changed. Without it, the only way to
   * keep the arm current after an edit was a full rebuild, so nothing did it:
   * a note written after the index was built could never be found by meaning.
   */
  private embedded = new Map<string, string>();

  constructor(private readonly embedder: IEmbedder) {}

  get ready(): boolean {
    return this.index !== null;
  }

  /** The encoder's own noise floor, if it declares one. */
  get minScore(): number | undefined {
    return this.embedder.minScore;
  }

  get size(): number {
    return this.index?.size ?? 0;
  }

  /**
   * Embed a corpus, replacing whatever was held.
   *
   * Progress is reported per batch rather than per passage: the callback drives
   * a progress bar, and a re-render per document would cost more than the
   * embedding.
   */
  async build(docs: readonly SearchDoc[], options: SemanticBuildOptions = {}): Promise<void> {
    const passages: { id: string; text: string }[] = [];
    // Where each document's passages end: it counts as embedded only once all are in.
    const ends: { end: number; doc: SearchDoc }[] = [];
    for (const doc of docs) {
      const chunks = readyCore().chunkForEmbedding(embeddableText(doc), { maxChars: CHUNK_CHARS });
      chunks.forEach((chunk, position) => {
        passages.push({ id: readyCore().passageId(doc.id, position), text: chunk.text });
      });
      ends.push({ end: passages.length, doc });
    }

    if (passages.length === 0) {
      this.index = null;
      this.embedded.clear();
      return;
    }

    const index = readyCore().createVectorIndex(this.embedder.dimensions || 384);
    const embedded = new Map<string, string>();
    let finished = 0;
    let lastCheckpoint = Date.now();
    for (let start = 0; start < passages.length; start += BATCH) {
      if (options.signal?.aborted) throw new Error("Indexing was cancelled.");
      const batch = passages.slice(start, start + BATCH);
      const vectors = await this.embedder.embed({
        texts: batch.map((passage) => passage.text),
        kind: "passage",
        signal: options.signal,
      });
      index.add(
        batch.map((passage) => passage.id),
        flatten(vectors),
      );
      const done = Math.min(start + BATCH, passages.length);
      while (finished < ends.length && ends[finished]!.end <= done) {
        const { doc } = ends[finished++]!;
        embedded.set(doc.id, hashOf(doc));
      }
      options.onProgress?.({ done, total: passages.length });
      if (options.onCheckpoint && done < passages.length && Date.now() - lastCheckpoint > CHECKPOINT_MS) {
        lastCheckpoint = Date.now();
        options.onCheckpoint(readyCore().packVectorIndex(this.embedder.id, index, embedded));
      }
    }

    this.index = index;
    this.embedderId = this.embedder.id;
    this.embedded = embedded;
  }

  /**
   * Nearest documents to a query.
   *
   * Passage hits collapse to their document, keeping the best score (Rust search_docs): a note
   * whose third paragraph answers the question should appear once, ranked by that paragraph.
   */
  async search(query: string, limit = 10): Promise<VectorHit[]> {
    const index = this.index;
    if (!index || readyCore().isBlankQuery(query)) return [];

    const [vector] = await this.embedder.embed({ texts: [query], kind: "query" });
    if (!vector) return [];

    return index.searchDocs(vector, limit);
  }

  /**
   * Documents nearest to one already indexed, by its own passages rather than
   * its title — a note titled "Tuesday" about attention heads should find
   * papers on attention. No forward pass: the vectors are already here (Rust 
earest_docs).
   */
  nearestTo(docId: string, limit = 10): VectorHit[] {
    return this.index?.nearestDocs(docId, limit) ?? [];
  }
  /** Re-embed one document's passages, leaving the rest of the index alone. */
  async update(docs: readonly SearchDoc[], options: SyncOptions = {}): Promise<void> {
    const index = this.index;
    if (!index) return;

    // Passage counts change with the text, so old ones are retracted by
    // prefix rather than by position — a shortened note must not leave its
    // former tail behind. Their hashes go too, so a checkpoint never claims them.
    const updating = new Set(docs.map((doc) => doc.id));
    index.remove(index.allIds().filter((id) => updating.has(readyCore().documentIdOf(id))));
    for (const id of updating) this.embedded.delete(id);

    const pieces = docs.map((doc) => ({
      doc,
      texts: readyCore().chunkForEmbedding(embeddableText(doc), { maxChars: CHUNK_CHARS }).map((chunk) => chunk.text),
    }));
    // Progress counts the whole index, so a resumed build carries on from where it was, not from 0.
    const total = index.size + pieces.reduce((sum, piece) => sum + piece.texts.length, 0);
    let lastCheckpoint = Date.now();

    // Documents are grouped into full batches: one forward pass per short note made a resumed build crawl.
    let group: typeof pieces = [];
    let pending = 0;
    const flush = async () => {
      const texts = group.flatMap((entry) => entry.texts);
      // A long paper alone can be hundreds of passages; one pass over all of them exhausts the WASM heap (std::bad_alloc).
      const vectors: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += BATCH) {
        vectors.push(...(await this.embedder.embed({ texts: texts.slice(start, start + BATCH), kind: "passage" })));
      }
      let at = 0;
      for (const { doc, texts: own } of group) {
        index.add(
          own.map((_, i) => readyCore().passageId(doc.id, i)),
          flatten(vectors.slice(at, at + own.length)),
        );
        at += own.length;
        this.embedded.set(doc.id, hashOf(doc));
      }
      group = [];
      pending = 0;
      options.onProgress?.({ done: index.size, total });
      if (options.onCheckpoint && index.size < total && Date.now() - lastCheckpoint > CHECKPOINT_MS) {
        lastCheckpoint = Date.now();
        options.onCheckpoint(readyCore().packVectorIndex(this.embedderId, index, this.embedded));
      }
    };
    for (const piece of pieces) {
      group.push(piece);
      pending += piece.texts.length;
      if (pending >= BATCH) await flush();
    }
    if (group.length > 0) await flush();
  }

  /**
   * Bring one slice of the corpus in line with `docs`.
   *
   * `owns` says which ids the slice covers (a kind, or one paper's pages): any
   * of those not in `docs` was deleted and is dropped; any whose text differs
   * from what was embedded is re-embedded. Unchanged documents cost nothing,
   * which is what makes calling this on every refresh affordable.
   *
   * Returns whether anything changed, so the caller knows to persist.
   */
  async sync(
    docs: readonly SearchDoc[],
    owns: (docId: string) => boolean,
    options: SyncOptions = {},
  ): Promise<boolean> {
    const index = this.index;
    if (!index) return false;

    const present = new Set(docs.map((doc) => doc.id));
    const gone = [...new Set(index.allIds().map((id) => readyCore().documentIdOf(id)))].filter((id) => owns(id) && !present.has(id));
    if (gone.length > 0) this.removeDocuments(gone);

    const changed = docs.filter((doc) => this.embedded.get(doc.id) !== hashOf(doc));
    if (changed.length > 0) await this.update(changed, options);
    return gone.length > 0 || changed.length > 0;
  }

  /** Drop documents entirely — a deletion, or a kind being re-projected. */
  removeDocuments(docIds: readonly string[]): void {
    const index = this.index;
    if (!index) return;
    const dropping = new Set(docIds);
    index.remove(index.allIds().filter((id) => dropping.has(readyCore().documentIdOf(id))));
    for (const id of docIds) this.embedded.delete(id);
  }

  /**
   * Pack for storage, tagged with the model that produced it.
   *
   * Vectors from one encoder are meaningless to another — the tag is what stops
   * a model change from silently returning nonsense instead of re-embedding.
   */
  serialize(): PackedIndex | null {
    return this.index ? readyCore().packVectorIndex(this.embedderId, this.index, this.embedded) : null;
  }

  /**
   * Restore stored vectors.
   *
   * `hashes` says what each document was embedded from, so a following `sync`
   * re-embeds exactly what changed while the app was closed. Older stores have
   * none; then `docs` — which the caller has matched to the vectors by corpus
   * revision — seeds the comparison instead.
   */
  load(
    stored: {
      model: string;
      dimensions: number;
      bytes: Uint8Array;
      hashes?: Record<string, string>;
    },
    docs: readonly SearchDoc[] = [],
  ): boolean {
    if (stored.model !== this.embedder.id) return false;
    try {
      // Records written before the blob format have no `bytes`: this throws, and the caller rebuilds.
      const index = readyCore().vectorIndexFromBytes(stored.bytes);
      // The width must match what was stored and, once the encoder is up, what it produces.
      if (index.dimensions !== stored.dimensions) return false;
      if (this.embedder.dimensions && index.dimensions !== this.embedder.dimensions) return false;
      this.index = index;
      this.embedderId = stored.model;
      this.embedded = stored.hashes
        ? new Map(Object.entries(stored.hashes))
        : new Map(docs.map((doc) => [doc.id, hashOf(doc)]));
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    this.index = null;
    this.embedded.clear();
  }
}
