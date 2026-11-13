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
