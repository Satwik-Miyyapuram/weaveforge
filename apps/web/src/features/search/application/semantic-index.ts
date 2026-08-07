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

export class SemanticIndex {
  private index: VectorIndex | null = null;
  private embedderId = "";

  constructor(private readonly embedder: IEmbedder) {}

  get ready(): boolean {
    return this.index !== null;
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

  /** Re-embed one document's passages, leaving the rest of the index alone. */
  async update(docs: readonly SearchDoc[]): Promise<void> {
    const index = this.index;
    if (!index) return;

    for (const doc of docs) {
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
    }
  }

  /** Drop documents entirely — a deletion, or a kind being re-projected. */
  removeDocuments(docIds: readonly string[]): void {
    const index = this.index;
    if (!index) return;
    const dropping = new Set(docIds);
    index.remove(index.allIds().filter((id) => dropping.has(documentIdOf(id))));
  }

  /**
   * Pack for storage, tagged with the model that produced it.
   *
   * Vectors from one encoder are meaningless to another — the tag is what stops
   * a model change from silently returning nonsense instead of re-embedding.
   */
  serialize(): { model: string; dimensions: number; ids: string[]; vectors: ArrayBuffer } | null {
    if (!this.index) return null;
    const { ids, vectors } = this.index.toBytes();
    return { model: this.embedderId, dimensions: this.index.dimensions, ids, vectors };
  }

  load(stored: { model: string; dimensions: number; ids: string[]; vectors: ArrayBuffer }): boolean {
    if (stored.model !== this.embedder.id) return false;
    try {
      this.index = VectorIndex.fromBytes(stored.dimensions, stored.ids, stored.vectors);
      this.embedderId = stored.model;
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    this.index = null;
  }
}
