/**
 * Every hardware sample behind one pointer event, in order. A `pointermove` is
 * one dispatch for many digitiser samples; `getCoalescedEvents()` returns the
 * ones merged into it (excluding the dispatch itself), so the dispatch is added
 * last. A missing or failing `getCoalescedEvents` falls back to the dispatch.
 */

export interface SampleEvent {
  clientX: number;
  clientY: number;
  pressure: number;
  getCoalescedEvents?: () => SampleEvent[];
}

export function pointerSamples(event: SampleEvent): SampleEvent[] {
  let merged: SampleEvent[] = [];
  try {
    merged = event.getCoalescedEvents?.() ?? [];
  } catch {
    merged = [];
  }
  return merged.length > 0 ? [...merged, event] : [event];
}
