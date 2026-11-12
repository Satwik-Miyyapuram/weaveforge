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
 * kept. Errors (not warnings) are also written once each to the desktop shell's
 * log file, which outlives the window; in a browser that is a no-op.
 *
 * The rules — the line a message becomes, the trim to the newest lines, the
 * message/detail split, and the de-duplication — are in Rust
 * (`wf_core::error_report::log_buffer`). This file holds the state and wraps the
 * console; it never throws into a console call, and before the Rust core has
 * loaded it skips the line rather than fail.
 */

import { readyCore } from "@/lib/rust-core";
import { logToApp } from "./app-log";

let lines: string[] = [];
let installed = false;
/** The failures already written, oldest first. Rust trims it to its cap. */
let seen: string[] = [];
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

/** Runs a core call; `fallback` when the core is not loaded, so capture never throws. */
function tryCore<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
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
      const text = args.map(describe).join(" ");
      tryCore(() => {
        const core = readyCore();
        lines = core.errorLogPushLine(lines, core.errorLogConsoleLine(level, text)) as string[];
        if (level === "error" && !alreadyRecorded(`console:${text}`)) {
          logToApp({ level: "error", source: "console", ...(core.errorLogEntry(text) as { message: string; detail?: string }) });
        }
      }, undefined);
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
  lines = tryCore(() => readyCore().errorLogRecordUncaught(lines, text) as string[], lines);
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
 * Bounded in Rust, and cleared with the rest of the capture. Before the core
 * loads nothing can be checked, so the failure counts as new.
 */
export function alreadyRecorded(text: string): boolean {
  return tryCore(() => {
    const result = readyCore().errorLogRemember(seen, text) as { seen: string[]; recorded: boolean };
    seen = result.seen;
    return result.recorded;
  }, false);
}

/**
 * Put the console back and empty the buffer, for tests.
 *
 * Restoring matters as much as clearing: resetting `installed` alone would let a
 * second install wrap the already-wrapped console, so every message would be
 * recorded twice and printed twice. The wrappers read `lines` and `seen` by name
 * at call time, so reassigning them here is seen by any wrapper still installed.
 */
export function resetLogCaptureForTest(): void {
  for (const restore of restores.splice(0)) restore();
  lines = [];
  seen = [];
  installed = false;
}
