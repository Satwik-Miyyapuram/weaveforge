/**
 * A brute-force vector index.
 *
 * No approximate-nearest-neighbour structure, deliberately. A thesis workspace
 * is thousands of passages, not millions: at 5 000 × 384 a full scan is about
 * two million multiply-adds, which is well under a millisecond and runs on
 * every keystroke without complaint. An HNSW graph would add a dependency, a
 * build step, a tuning surface, and a recall cliff, to beat a number that is
 * already imperceptible.
 *
 * Vectors live in one contiguous `Float32Array` rather than an array of arrays.
 * The scan is memory-bound, and a million small allocations scattered across
 * the heap is the difference between fast and merely acceptable.
 */

import { normalizeVector } from "./embedding-port.js";

export interface VectorHit {
  id: string;
  /** Cosine similarity in [-1, 1]; normalized vectors make it a dot product. */
  score: number;
}

export interface VectorEntry {
  id: string;
  vector: Float32Array;
}

export class VectorDimensionError extends Error {
  constructor(expected: number, got: number) {
    super(`Vector has ${got} dimensions, index holds ${expected}.`);
    this.name = "VectorDimensionError";
  }
}

/** Grow by half again, so a bulk insert does not reallocate per vector. */
function grownCapacity(needed: number, current: number): number {
  let next = Math.max(current, 64);
  while (next < needed) next = Math.ceil(next * 1.5);
  return next;
}

export class VectorIndex {
  private data: Float32Array;
  private ids: string[] = [];
  private slotById = new Map<string, number>();
  private count = 0;

  constructor(readonly dimensions: number, capacity = 256) {
    this.data = new Float32Array(dimensions * capacity);
  }

  get size(): number {
    return this.count;
  }

  has(id: string): boolean {
    return this.slotById.has(id);
  }

  /**
   * Insert or replace. Vectors are normalized on the way in so search is a dot
   * product; the caller's array is not modified.
   */
  add(entries: readonly VectorEntry[]): void {
    for (const entry of entries) {
      if (entry.vector.length !== this.dimensions) {
        throw new VectorDimensionError(this.dimensions, entry.vector.length);
      }

      const existing = this.slotById.get(entry.id);
      const slot = existing ?? this.count;
      if (existing === undefined) {
        this.ensureCapacity(this.count + 1);
        this.ids[slot] = entry.id;
        this.slotById.set(entry.id, slot);
        this.count += 1;
      }

      const normalized = normalizeVector(Float32Array.from(entry.vector));
      this.data.set(normalized, slot * this.dimensions);
    }
  }

  /**
   * Remove by id.
   *
   * The last vector is moved into the freed slot rather than the array being
   * compacted: order carries no meaning here, and a swap is constant time where
   * a shift is linear in the size of the index.
   */
  remove(ids: readonly string[]): void {
    for (const id of ids) {
      const slot = this.slotById.get(id);
      if (slot === undefined) continue;

      const last = this.count - 1;
      if (slot !== last) {
        const movedId = this.ids[last]!;
        this.data.copyWithin(slot * this.dimensions, last * this.dimensions, (last + 1) * this.dimensions);
        this.ids[slot] = movedId;
        this.slotById.set(movedId, slot);
      }
      this.ids.pop();
      this.slotById.delete(id);
      this.count = last;
    }
  }

  clear(): void {
    this.ids = [];
    this.slotById.clear();
    this.count = 0;
  }

  /**
   * Top `limit` by cosine similarity.
   *
   * Results below `minScore` are dropped rather than padded out. A vector
   * search always returns *something* — everything has some similarity to
   * everything — and a list of near-random passages under a real answer is
   * worse than a short list.
   */
  search(query: Float32Array, limit = 10, minScore = 0.2): VectorHit[] {
    if (query.length !== this.dimensions) {
      throw new VectorDimensionError(this.dimensions, query.length);
    }
    if (this.count === 0 || limit <= 0) return [];

    const probe = normalizeVector(Float32Array.from(query));
    const hits: VectorHit[] = [];

    for (let slot = 0; slot < this.count; slot += 1) {
      const offset = slot * this.dimensions;
      let score = 0;
      for (let d = 0; d < this.dimensions; d += 1) score += this.data[offset + d]! * probe[d]!;
      if (score < minScore) continue;
      hits.push({ id: this.ids[slot]!, score });
    }

    hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return hits.slice(0, limit);
  }

  /** Ids currently held, in no meaningful order. */
  allIds(): string[] {
    return this.ids.slice(0, this.count);
  }

  /**
   * Pack for storage: the ids as JSON, the vectors as one buffer.
   *
   * Float32 rather than a quantized form. Eight-bit vectors would be four times
   * smaller, but they trade recall for bytes, and at a few megabytes there is
   * nothing here worth trading it for.
   */
  toBytes(): { ids: string[]; vectors: ArrayBuffer } {
    const packed = this.data.slice(0, this.count * this.dimensions);
    return { ids: this.allIds(), vectors: packed.buffer as ArrayBuffer };
  }

  static fromBytes(dimensions: number, ids: readonly string[], vectors: ArrayBuffer): VectorIndex {
    const values = new Float32Array(vectors);
    // A mismatch means the stored data was written by another model or another
    // version. Rejecting it costs a re-embed; trusting it produces silent
    // nonsense in every result.
    if (values.length !== ids.length * dimensions) {
      throw new VectorDimensionError(dimensions, ids.length ? values.length / ids.length : 0);
    }

    const index = new VectorIndex(dimensions, Math.max(ids.length, 64));
    index.data.set(values);
    index.ids = [...ids];
    index.count = ids.length;
    ids.forEach((id, slot) => index.slotById.set(id, slot));
    return index;
  }

  private ensureCapacity(needed: number): void {
    const capacity = this.data.length / this.dimensions;
    if (needed <= capacity) return;
    const grown = new Float32Array(grownCapacity(needed, capacity) * this.dimensions);
    grown.set(this.data);
    this.data = grown;
  }
}
