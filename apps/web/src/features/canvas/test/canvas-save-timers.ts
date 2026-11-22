/** A timer that only fires when the test says so. */
export function fakeTimers() {
  let next = 1;
  const armed = new Map<number, () => void>();
  return {
    schedule: (fn: () => void) => {
      const id = next++;
      armed.set(id, fn);
      return id;
    },
    unschedule: (handle: unknown) => {
      armed.delete(handle as number);
    },
    fire: () => {
      for (const [id, fn] of [...armed]) {
        armed.delete(id);
        fn();
      }
    },
    armedCount: () => armed.size,
  };
}

/** Lets queued promise callbacks run. */
export const tick = () => new Promise((resolve) => setImmediate(resolve));
