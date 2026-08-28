import type { BlobObjectRecord } from "./blob-registry-ports.js";

/** Tunable weights for the GDSF-inspired eviction score (see docs/running/storage/tiering.md). */
export interface BlobTieringWeights {
  /** Days idle multiplier (LRU). Default 1.0 */
  alpha: number;
  /** Inverse-frequency multiplier (LFU). Default 30.0 */
  beta: number;
  /** Business-priority multiplier. Default 0.5 */
  gamma: number;
}

const DEFAULT_BLOB_TIERING_WEIGHTS: BlobTieringWeights = {
  alpha: 1,
  beta: 30,
  gamma: 0.5,
};

/**
 * Higher score → migrate to cold tier first when R2 is near capacity.
 *
 * score = α × days_since_last_access + β / log₂(access_count + 2) + γ × (100 − priority)
 */
export function computeBlobEvictionScore(
  record: BlobObjectRecord,
  now: Date = new Date(),
  weights: BlobTieringWeights = DEFAULT_BLOB_TIERING_WEIGHTS,
): number {
  const ref = record.lastAccessedAt ?? record.createdAt;
  const daysIdle = Math.max(0, (now.getTime() - ref.getTime()) / 86_400_000);
  const freqTerm = weights.beta / Math.log2(record.accessCount + 2);
  const priorityTerm = weights.gamma * (100 - record.priority);
  return weights.alpha * daysIdle + freqTerm + priorityTerm;
}

/** Sort hot candidates for tier-off (highest score first). */
export function rankForEviction(
  records: BlobObjectRecord[],
  now?: Date,
  weights?: BlobTieringWeights,
): BlobObjectRecord[] {
  return [...records].sort(
    (a, b) =>
      computeBlobEvictionScore(b, now, weights) - computeBlobEvictionScore(a, now, weights),
  );
}
