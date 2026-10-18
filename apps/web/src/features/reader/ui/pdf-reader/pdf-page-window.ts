export const PDF_KEEP_RADIUS = 3;

export function pagesToEvict(
  rendered: Iterable<number>,
  visible: Iterable<number>,
  radius = PDF_KEEP_RADIUS,
): number[] {
  const vis = Array.from(visible);
  if (vis.length === 0) return [];
  const toEvict: number[] = [];
  const seen = new Set<number>();
  for (const page of rendered) {
    if (seen.has(page)) continue;
    seen.add(page);
    let minDistance = Infinity;
    for (const v of vis) {
      const d = Math.abs(page - v);
      if (d < minDistance) {
        minDistance = d;
      }
    }
    if (minDistance > radius) {
      toEvict.push(page);
    }
  }
  return toEvict.sort((a, b) => a - b);
}

interface SchedulerPostTaskOptions {
  priority?: "user-blocking" | "user-visible" | "background";
  signal?: AbortSignal;
}

interface WebScheduler {
  postTask(callback: () => void | Promise<void>, options?: SchedulerPostTaskOptions): Promise<void>;
}

export function idle(signal?: { cancelled: boolean }): Promise<void> {
  if (signal?.cancelled) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const g = globalThis as unknown as {
      scheduler?: WebScheduler;
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };
    if (typeof g.scheduler?.postTask === "function") {
      g.scheduler
        .postTask(() => {
          resolve();
        }, { priority: "background" })
        .catch(() => {
          resolve();
        });
      return;
    }
    if (typeof g.requestIdleCallback === "function") {
      g.requestIdleCallback(() => {
        resolve();
      }, { timeout: 200 });
      return;
    }
    setTimeout(resolve, 0);
  });
}
