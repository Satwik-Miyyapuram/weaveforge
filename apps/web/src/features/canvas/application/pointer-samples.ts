/**
 * Every hardware sample behind one pointer event, in order. A `pointermove` is
 * one dispatch for many digitiser samples; `getCoalescedEvents()` returns them.
 * Chromium (WebView2) ends that list with the dispatch itself; other engines may
 * not, so the dispatch is appended only when the list does not already end on it.
 * A React synthetic event has no `getCoalescedEvents`, so its `nativeEvent` is
 * read. A missing or failing `getCoalescedEvents` falls back to the dispatch.
 */

export interface SampleEvent {
  clientX: number;
  clientY: number;
  pressure: number;
  getCoalescedEvents?: () => SampleEvent[];
  /** Present on a React synthetic event: the DOM event it wraps. */
  nativeEvent?: SampleEvent;
}

export function pointerSamples(event: SampleEvent): SampleEvent[] {
  const source = event.nativeEvent ?? event;
  let merged: SampleEvent[] = [];
  try {
    merged = source.getCoalescedEvents?.() ?? [];
  } catch {
    merged = [];
  }
  if (merged.length === 0) return [source];
  const last = merged[merged.length - 1]!;
  const endsOnDispatch = last.clientX === source.clientX && last.clientY === source.clientY;
  return endsOnDispatch ? merged : [...merged, source];
}
