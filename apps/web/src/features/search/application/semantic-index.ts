import {
  VectorIndex,
  chunkForEmbedding,
  type IEmbedder,
  type SearchDoc,
  type VectorHit,
} from "@weaveforge/core";

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
  signal?: AbortSignal;
}

/** `note:n1` → `note:n1#2` for its third passage. */
function passageId(docId: string, index: number): string {
  return `${docId}#${index}`;
}

export function documentIdOf(passage: string): string {
  const hash = passage.lastIndexOf("#");
  return hash < 0 ? passage : passage.slice(0, hash);
}

/**
 * Text worth embedding for a document.
 *
 * The title is repeated into the first passage because a short note is often
 * only its title, and a body-only vector for "Attention" carries almost
 * nothing.
 */
function embeddableText(doc: SearchDoc): string {
  const head = [doc.title, ...doc.aliases].filter(Boolean).join(". ");
  const body = doc.body.trim();
  return body ? `${head}. ${body}` : head;
}

/**
 * A short fingerprint of what a document was embedded from.
 *
 * Stored beside the vectors so a reload can tell which documents changed while
 * the app was closed and re-embed only those. Without it the only check was a
 * fingerprint of the whole corpus, and one edited note meant embedding
 * thousands of passages again. FNV-1a plus the length: a collision costs one
 * stale vector until the next edit, never a wrong result elsewhere.
 */
export function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}.${text.length.toString(36)}`;
}

const hashOf = (doc: SearchDoc) => textHash(embeddableText(doc));

export class SemanticIndex {
  private index: VectorIndex | null = null;
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
    for (const doc of docs) {
      const chunks = chunkForEmbedding(embeddableText(doc), { maxChars: CHUNK_CHARS });
      chunks.forEach((chunk, position) => {
        passages.push({ id: passageId(doc.id, position), text: chunk.text });
      });
    }

    if (passages.length === 0) {
      this.index = null;
      this.embedded.clear();
      return;
    }

    const index = new VectorIndex(this.embedder.dimensions || 384, passages.length);
    for (let start = 0; start < passages.length; start += BATCH) {
      if (options.signal?.aborted) throw new Error("Indexing was cancelled.");
      const batch = passages.slice(start, start + BATCH);
      const vectors = await this.embedder.embed({
        texts: batch.map((passage) => passage.text),
        kind: "passage",
        signal: options.signal,
      });
      index.add(batch.map((passage, i) => ({ id: passage.id, vector: vectors[i]! })));
      options.onProgress?.({ done: Math.min(start + BATCH, passages.length), total: passages.length });
    }

    this.index = index;
    this.embedderId = this.embedder.id;
    this.embedded = new Map(docs.map((doc) => [doc.id, hashOf(doc)]));
  }

  /**
   * Nearest documents to a query.
   *
   * Passage hits collapse to their document, keeping the best score: a note
   * whose third paragraph answers the question should appear once, ranked by
   * that paragraph, not three times for three near-misses.
   */
  async search(query: string, limit = 10): Promise<VectorHit[]> {
    const index = this.index;
    if (!index || query.trim() === "") return [];

    const [vector] = await this.embedder.embed({ texts: [query], kind: "query" });
    if (!vector) return [];

    const best = new Map<string, number>();
    // Over-fetch: several passages of one document can crowd out the runner-up,
    // so the collapse needs more candidates than the caller asked for.
    for (const hit of index.search(vector, limit * 4)) {
      const docId = documentIdOf(hit.id);
      const current = best.get(docId);
      if (current === undefined || hit.score > current) best.set(docId, hit.score);
    }

    return [...best.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  /**
   * Documents nearest to one already indexed, by its own passages rather than
   * its title — a note titled "Tuesday" about attention heads should find
   * papers on attention. No forward pass: the vectors are already here.
   */
  nearestTo(docId: string, limit = 10): VectorHit[] {
    const index = this.index;
    if (!index) return [];
    const best = new Map<string, number>();
    for (let i = 0; ; i += 1) {
      const vector = index.vectorOf(passageId(docId, i));
      if (!vector) break;
      for (const hit of index.search(vector, limit * 4)) {
        const id = documentIdOf(hit.id);
        if (id === docId) continue;
        const current = best.get(id);
        if (current === undefined || hit.score > current) best.set(id, hit.score);
      }
      // Long documents: the opening passages are what the document is about.
      if (i >= 3) break;
    }
    return [...best.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  /** Re-embed one document's passages, leaving the rest of the index alone. */
  async update(docs: readonly SearchDoc[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const index = this.index;
    if (!index) return;

    let done = 0;
    for (const doc of docs) {
      onProgress?.(done++, docs.length);
      // Passage counts change with the text, so old ones are retracted by
      // prefix rather than by position — a shortened note must not leave its
      // former tail behind.
      const stale = index.allIds().filter((id) => documentIdOf(id) === doc.id);
      index.remove(stale);

      const chunks = chunkForEmbedding(embeddableText(doc), { maxChars: CHUNK_CHARS });
      if (chunks.length === 0) continue;
      const vectors = await this.embedder.embed({
        texts: chunks.map((chunk) => chunk.text),
        kind: "passage",
      });
      index.add(chunks.map((_, i) => ({ id: passageId(doc.id, i), vector: vectors[i]! })));
      this.embedded.set(doc.id, hashOf(doc));
    }
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
    onProgress?: (done: number, total: number) => void,
  ): Promise<boolean> {
    const index = this.index;
    if (!index) return false;

    const present = new Set(docs.map((doc) => doc.id));
    const gone = [...new Set(index.allIds().map(documentIdOf))].filter((id) => owns(id) && !present.has(id));
    if (gone.length > 0) this.removeDocuments(gone);

    const changed = docs.filter((doc) => this.embedded.get(doc.id) !== hashOf(doc));
    if (changed.length > 0) await this.update(changed, onProgress);
    return gone.length > 0 || changed.length > 0;
  }

  /** Drop documents entirely — a deletion, or a kind being re-projected. */
  removeDocuments(docIds: readonly string[]): void {
    const index = this.index;
    if (!index) return;
    const dropping = new Set(docIds);
    index.remove(index.allIds().filter((id) => dropping.has(documentIdOf(id))));
    for (const id of docIds) this.embedded.delete(id);
  }

  /**
   * Pack for storage, tagged with the model that produced it.
   *
   * Vectors from one encoder are meaningless to another — the tag is what stops
   * a model change from silently returning nonsense instead of re-embedding.
   */
  serialize(): {
    model: string;
    dimensions: number;
    ids: string[];
    vectors: ArrayBuffer;
    hashes: Record<string, string>;
  } | null {
    if (!this.index) return null;
    const { ids, vectors } = this.index.toBytes();
    return {
      model: this.embedderId,
      dimensions: this.index.dimensions,
      ids,
      vectors,
      hashes: Object.fromEntries(this.embedded),
    };
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
      ids: string[];
      vectors: ArrayBuffer;
      hashes?: Record<string, string>;
    },
    docs: readonly SearchDoc[] = [],
  ): boolean {
    if (stored.model !== this.embedder.id) return false;
    try {
      this.index = VectorIndex.fromBytes(stored.dimensions, stored.ids, stored.vectors);
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
