/**
 * Tell every listener, in order. One that throws is logged under `area` and
 * passed over: its failure is its own, and must neither stop the others
 * hearing nor reach whatever made the announcement.
 *
 * The listeners are copied first, so one that subscribes or unsubscribes
 * while being told changes who hears next time, not this time.
 */
export function notifyEach<A extends unknown[]>(
  listeners: Iterable<(...args: A) => void>,
  area: string,
  ...args: A
): void {
  for (const listener of [...listeners]) {
    try {
      listener(...args);
    } catch (error) {
      console.warn(`[${area}] a listener failed:`, error);
    }
  }
}
