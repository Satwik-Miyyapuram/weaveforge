/**
 * Input-to-draw latency, for the ink tuning panel. The pen stamps each batch it
 * posts to the worker (`sentAt`, wall-clock ms from `performance.timeOrigin`);
 * the worker reports the oldest undrawn stamp's age with the frame that drew it;
 * this keeps the latest frames and gives p50 and p95 over them.
 */

export interface LatencySummary {
  count: number;
  p50: number | null;
  p95: number | null;
}

export class LatencyWindow {
  private readonly samples: number[] = [];
  private next = 0;

  constructor(private readonly size = 240) {}

  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this.samples.length < this.size) this.samples.push(ms);
    else this.samples[this.next] = ms;
    this.next = (this.next + 1) % this.size;
  }

  summary(): LatencySummary {
    const count = this.samples.length;
    if (count === 0) return { count, p50: null, p95: null };
    const sorted = [...this.samples].sort((a, b) => a - b);
    // Nearest rank: the smallest sample with at least p% of samples at or below it.
    const at = (p: number) => sorted[Math.max(0, Math.ceil((p / 100) * count) - 1)] ?? null;
    return { count, p50: at(50), p95: at(95) };
  }
}

/** Wall-clock now, comparable across the page and its workers. */
export function inkClock(): number {
  return performance.timeOrigin + performance.now();
}

const appWindow = new LatencyWindow();

export function recordInkLatency(ms: number): void {
  appWindow.push(ms);
}

export function inkLatency(): LatencySummary {
  return appWindow.summary();
}
