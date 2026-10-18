/** User Timing measures for the speed baseline (docs/plans/speed-plan.md); off unless localStorage "wf:perf" is "1". */
const on = (() => {
  try {
    return typeof performance !== "undefined" && globalThis.localStorage?.getItem("wf:perf") === "1";
  } catch {
    return false;
  }
})();

/** A start time to hand to `perfEnd`, or null when measuring is off. */
export function perfStart(): number | null {
  return on ? performance.now() : null;
}

export function perfEnd(name: string, start: number | null, detail?: unknown): void {
  if (start === null) return;
  performance.measure(name, { start, end: performance.now(), detail });
}

/** Ends a measure once the frame after the current one has painted. */
export function perfEndAfterPaint(name: string, start: number | null, detail?: unknown): void {
  if (start === null) return;
  requestAnimationFrame(() => setTimeout(() => perfEnd(name, start, detail), 0));
}

let nav: { from: string; start: number } | null = null;

export function perfNavStart(from: string): void {
  const start = perfStart();
  if (start !== null) nav = { from, start };
}

export function perfNavEnd(to: string): void {
  if (!nav || nav.from === to) return;
  perfEndAfterPaint(`nav:${nav.from}->${to}`, nav.start);
  nav = null;
}
