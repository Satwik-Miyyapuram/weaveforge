/**
 * The console history a report is allowed to carry.
 *
 * A bug report without logs is a guess, and a bug report with *all* logs is a
 * transcript of somebody's afternoon. So the collector takes errors and warnings
 * and nothing else: `console.log` in this app prints note titles, fetched
 * abstracts, entity ids and whatever a developer was looking at, and none of that
 * belongs in a public issue. What is left is the signal — the messages a person
 * would have seen in their console anyway.
 *
 * The buffer is fixed-size and in memory: an old warning is dropped rather than
 * kept, and nothing is written to disk.
 */

const MAX_LINES = 40;

const lines: string[] = [];
let installed = false;
/** How to unwrap each console method, so a test can leave the console as it found it. */
const restores: (() => void)[] = [];

/** One console argument, as a line a person can read. */
function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Start capturing. Idempotent, and called once from the client runtime — early,
 * because a log written before the error screen appears is exactly the context
 * the reader cannot reconstruct afterwards.
 */
export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;

  for (const level of ["error", "warn"] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      lines.push(`[${level}] ${args.map(describe).join(" ")}`);
      if (lines.length > MAX_LINES) lines.shift();
      original.apply(console, args);
    };
    restores.push(() => {
      console[level] = original;
    });
  }
}

/** What the report will carry. Empty until something has been logged. */
export function recentLogs(): string {
  return lines.join("\n");
}

/**
 * Record something that never reached the console.
 *
 * A browser reports an uncaught error by printing it *itself* — the message does
 * not travel through the `console.error` function — and an unhandled rejection
 * may be printed by nobody at all. Both are exactly the failures a reader wants to
 * report, so the window handlers that already watch for them record them here. The
 * trace is the point: `window.onerror` carries the message, the file and the line,
 * and the `Error` behind a rejection carries the stack.
 */
export function recordError(text: string): void {
  if (!text) return;
  lines.push(`[uncaught] ${text}`);
  if (lines.length > MAX_LINES) lines.shift();
}

/**
 * Whether this exact failure has already happened in this window.
 *
 * The same error event fires again for every re-render, retry and route change
 * that repeats it, and the shell's log is a file that outlives the window — a
 * render loop can write thousands of identical lines into a record a person is
 * expected to read. Remembering the *text* rather than a count is enough: two
 * occurrences of a byte-identical stack with a byte-identical origin line are
 * the same failure happening twice, and one line about it is the honest report.
 *
 * Bounded, and cleared with the rest of the capture. A `Set` of every stack a
 * long session ever produced would itself become the leak.
 */
const seen = new Set<string>();
const MAX_SEEN = 200;

export function alreadyRecorded(text: string): boolean {
  if (!text) return true;
  if (seen.has(text)) return true;
  seen.add(text);
  if (seen.size > MAX_SEEN) {
    // Oldest-first: a `Set` iterates in insertion order.
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return false;
}

/**
 * Put the console back and empty the buffer, for tests.
 *
 * Restoring matters as much as clearing: resetting `installed` alone would let a
 * second install wrap the already-wrapped console, so every message would be
 * recorded twice and printed twice. And the buffer is emptied in place rather
 * than reassigned, because the installed wrappers close over this array.
 */
export function resetLogCaptureForTest(): void {
  for (const restore of restores.splice(0)) restore();
  lines.length = 0;
  seen.clear();
  installed = false;
}
