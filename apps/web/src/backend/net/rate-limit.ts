/**
 * Per-user request budgets, for the routes that do work on somebody else's
 * behalf.
 *
 * `/api/fetch-url` is the case that needed one: an authenticated caller can ask
 * the server to download images repeatedly, so the server's memory and the
 * destination's bandwidth are spent at the caller's rate rather than their own.
 * The token requirement decides *who* may ask; this decides *how often*, which
 * is the half that bounds the cost.
 *
 * A token bucket rather than a fixed window: a burst of a couple of pastes in a
 * second is a person dropping several images at once, and refusing the second one
 * would be a bug report rather than a defence. The refill rate is what bounds the
 * sustained cost, and the bucket is what lets a normal interaction through.
 *
 * In-process, and that is a limitation worth stating rather than hiding: two
 * server instances have two buckets, so the effective limit is per instance. The
 * deployment declares no replicas (`infra/oci/docker-compose.yml` serves the web
 * app from one process), which is what makes this sufficient today; a
 * multi-instance deployment needs the counter in Postgres, where the share-link
 * limiter already lives.
 *
 * The clock is injected so the tests do not sleep.
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** Requests left in the bucket after this one. */
  remaining: number;
  /** Seconds until the bucket has room for one more; 0 while allowed. */
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  /** Tokens the bucket holds. A burst larger than this is refused. */
  capacity: number;
  /** Tokens added per second, which is the sustained rate. */
  refillPerSecond: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly options: RateLimitOptions) {}

  /**
   * Spend one token for `key`, or refuse.
   *
   * A bucket per key, created full, refilled by elapsed time and capped at
   * capacity. Nothing evicts a bucket for a user who stops asking; the map holds
   * one small object per identity that has ever asked, which is bounded by the
   * number of accounts and not by traffic.
   */
  take(key: string): RateLimitDecision {
    const now = this.options.now?.() ?? Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.options.capacity, updatedAt: now };

    const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
    const tokens = Math.min(
      this.options.capacity,
      bucket.tokens + elapsedSeconds * this.options.refillPerSecond,
    );

    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      const missing = 1 - tokens;
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(missing / this.options.refillPerSecond)),
      };
    }

    const left = tokens - 1;
    this.buckets.set(key, { tokens: left, updatedAt: now });
    return { allowed: true, remaining: Math.floor(left), retryAfterSeconds: 0 };
  }
}

/**
 * The budget for pasted-resource fetches.
 *
 * Twenty in a burst and one refilled every two seconds: a person pasting a page
 * of figures gets through, and a loop gets 0.5 requests a second, which makes the
 * amplifier uninteresting without making the feature feel broken. Both numbers
 * live here so the test asserts the policy rather than repeating its arithmetic.
 */
export const PASTE_FETCH_LIMIT: RateLimitOptions = { capacity: 20, refillPerSecond: 0.5 };

/** One limiter for the process, so the budget is shared across requests. */
export const pasteFetchLimiter = new RateLimiter(PASTE_FETCH_LIMIT);
