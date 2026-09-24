import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The application log: what the window asked for and what it got back.
 *
 * This exists because a dead window leaves no record. Nothing in this app wrote
 * a file about itself, so when a request failed — a 403 from a provider, a
 * custom protocol handler returning nothing, a fetch that never settled — the
 * only trace was a console line in a process the reader then closed. Two
 * diagnoses in one session came down to "if only the last request had been on
 * disk", which is what this is.
 *
 * Three decisions carry the design:
 *
 *   * **It is a file in `userData`, above everything the app does.** The window
 *     is a renderer; when the renderer is gone the main process is still here,
 *     and a record that only lives in the renderer dies with it. So the buffer
 *     and the writer live on this side, and the page posts to them over IPC.
 *   * **It is bounded twice.** A memory ring of {@link MAX_ENTRIES} so a page in
 *     a retry loop cannot grow the process, and a byte ceiling on the file so a
 *     month of running cannot fill a disk. The file is trimmed by rewriting the
 *     tail, which is the only way to drop the head of a file.
 *   * **A failure to log is not a failure.** Every write is fire-and-forget and
 *     swallows its own error: an app that will not start because its log
 *     directory is read-only has turned diagnostics into an outage. The memory
 *     ring stays correct whether or not the disk took the line.
 *
 * Injected `dir` and injected `console`, so the rules can be tested without an
 * app and without a disk.
 */

export interface AppLogEntry {
  /** ISO-8601, written by this side rather than trusted from the page. */
  at: string;
  level: "error" | "warn" | "info";
  /** Where it came from: `renderer`, `request`, `main`, `uncaught`. */
  source: string;
  message: string;
  /** Free-form context — a URL, a status, a route. Omitted when empty. */
  detail?: string;
}

/** How many entries are kept in memory and answerable over IPC. */
export const MAX_ENTRIES = 500;
/** How large the file on disk may grow before its head is dropped. */
export const MAX_FILE_BYTES = 1_000_000;
/** How much of a failing response body is kept. A whole page is not a log line. */
const MAX_DETAIL_CHARS = 2_000;

export interface AppLog {
  /** Record one entry. Never throws, never rejects. */
  record(entry: Omit<AppLogEntry, "at"> & { at?: string }): void;
  /** The entries held in memory, oldest first. */
  entries(): readonly AppLogEntry[];
  /** Where the file is. Shown to the reader so they can find it themselves. */
  file(): string;
  /**
   * Mirror this process's own `console` into the log.
   *
   * The main process is where the shell's own failures are printed — the local
   * database failing to open, an update check declining, a refused IPC call —
   * and none of those reached a file before. Installed once; idempotent.
   */
  installConsoleCapture(): void;
  /**
   * Take the newest lines of the existing file into the memory ring.
   *
   * Without this the panel shows "nothing has been logged" on a fresh launch
   * while the file beside it holds the whole previous session — which is the
   * one moment a reader most needs it, because the window that died is the
   * reason they opened the panel. The file is the record; the ring is a window
   * onto it, and this is what makes the window start somewhere useful.
   */
  restoreFromDisk(): Promise<void>;
  /** Resolve once every append queued so far has finished, for tests. */
  flush(): Promise<void>;
}

export interface AppLogOptions {
  /**
   * Where the log lives. `app.getPath("userData")` in production — and a
   * function there, because that path needs a ready app while this object is
   * built before `whenReady`, so the directory has to be resolved per write
   * rather than captured once at construction. A plain string is accepted for
   * tests, which have no `app` to ask.
   */
  dir: string | (() => string);
  /** The console to wrap. Injected so a test can pass its own. */
  target?: Pick<Console, "log" | "warn" | "error">;
  /** Injectable for tests; defaults to the real clock. */
  now?: () => Date;
}

/** The file's name inside the data directory. */
export const APP_LOG_FILENAME = "weaveforge.log";

export function createAppLog(options: AppLogOptions): AppLog {
  const dirOf = typeof options.dir === "function" ? options.dir : () => options.dir as string;
  const now = options.now ?? (() => new Date());
  const held: AppLogEntry[] = [];
  let bytes = 0;
  let installed = false;
  /** The tail of the write chain: every append runs after the one before it. */
  let tail: Promise<void> = Promise.resolve();

  const clip = (text: string, limit = MAX_DETAIL_CHARS): string =>
    text.length > limit ? `${text.slice(0, limit)}…[${text.length - limit} more]` : text;

  async function append(line: string): Promise<void> {
    try {
      const dir = dirOf();
      await mkdir(dir, { recursive: true });
      await appendFile(path.join(dir, APP_LOG_FILENAME), line, "utf8");
      bytes += Buffer.byteLength(line, "utf8");
      if (bytes > MAX_FILE_BYTES) await trim();
    } catch {
      // See the module comment: an unwritable log is not an outage. The memory
      // ring is the answer over IPC either way.
    }
  }

  /**
   * Drop the head of the file, keeping the newest lines under the ceiling.
   *
   * A file cannot be shortened from the front, so this reads it, cuts it and
   * writes it back through a draft — a crash mid-trim leaves a complete file
   * rather than a truncated one. The draft is what makes this safe to run
   * without a lock: only the write chain calls it, so two trims never overlap.
   *
   * A read that fails *aborts the trim*, and that is the important part. The
   * first version read with `.catch(() => "")`, which turned "the log could not
   * be read" — locked by the editor the reader just opened it in, a permission
   * problem, a disk having a bad day — into "the log is empty", and then wrote
   * that empty file over the real one. Refusing to trim costs some bytes past
   * the ceiling; trimming on a failed read loses the record.
   */
  async function trim(): Promise<void> {
    const file = path.join(dirOf(), APP_LOG_FILENAME);
    const text = await readFile(file, "utf8");
    const lines = text.split("\n").filter((line) => line.length > 0);
    const kept: string[] = [];
    let size = 0;
    for (const line of lines.slice().reverse()) {
      const length = Buffer.byteLength(line, "utf8") + 1;
      if (size + length > MAX_FILE_BYTES / 2) break;
      kept.unshift(line);
      size += length;
    }
    const draft = `${file}.draft`;
    await writeFile(draft, kept.length === 0 ? "" : `${kept.join("\n")}\n`, "utf8");
    await rename(draft, file);
    bytes = size;
  }

  function record(entry: Omit<AppLogEntry, "at"> & { at?: string }): void {
    const full: AppLogEntry = {
      at: entry.at ?? now().toISOString(),
      level: entry.level,
      source: entry.source,
      message: clip(entry.message, 4_000),
      ...(entry.detail ? { detail: clip(entry.detail) } : {}),
    };
    held.push(full);
    if (held.length > MAX_ENTRIES) held.shift();
    const line = `${JSON.stringify(full)}\n`;
    // Queued, not awaited: a caller on an IPC path must not wait on a disk, and
    // the chain is what keeps two lines from interleaving mid-write.
    tail = tail.then(() => append(line));
  }

  function installConsoleCapture(): void {
    if (installed) return;
    installed = true;
    const target = options.target ?? console;
    for (const level of ["log", "warn", "error"] as const) {
      const original = target[level].bind(target);
      target[level] = (...args: unknown[]) => {
        record({
          level: level === "log" ? "info" : level,
          source: "main",
          message: args.map(describe).join(" "),
        });
        original(...args);
      };
    }
  }

  /**
   * The newest lines already on disk, minus anything this process wrote.
   *
   * Idempotent in the sense that matters: a second call appends nothing, because
   * a line this process already recorded is already in `held`. A line the file
   * holds from an earlier session is not, and that is the point.
   */
  async function restoreFromDisk(): Promise<void> {
    let text: string;
    try {
      text = await readFile(path.join(dirOf(), APP_LOG_FILENAME), "utf8");
    } catch {
      // No file yet, which is the normal first run. Nothing to restore.
      return;
    }
    // How many lines there is room for, given anything this process has already
    // said. The file's own cap is `MAX_ENTRIES` lines, so the tail is taken
    // first and then trimmed to fit: restoring could otherwise push the array
    // past its bound, and the ring is the one thing that must not grow.
    const room = Math.max(0, MAX_ENTRIES - held.length);
    const seen = new Set(held.map((entry) => entry.at + entry.message));
    const older = text
      .split("\n")
      .filter((line) => line.length > 0)
      .slice(-MAX_ENTRIES)
      .flatMap<AppLogEntry>((line) => {
        try {
          const parsed: unknown = JSON.parse(line);
          // `null`, a bare number and a string are all valid JSON and none of
          // them is an entry; reading `.at` off one would be the exception this
          // is here to swallow, and it would take the whole restore with it.
          if (typeof parsed !== "object" || parsed === null) return [];
          const entry = parsed as Partial<AppLogEntry>;
          if (typeof entry.at !== "string" || typeof entry.message !== "string") return [];
          if (seen.has(entry.at + entry.message)) return [];
          return [entry as AppLogEntry];
        } catch {
          // A half-written final line, from a process that died mid-append.
          // Dropped rather than guessed at.
          return [];
        }
      })
      // Prepended: the restored lines are older than anything this process has
      // said, and `record` only ever appends.
      .slice(-room);
    held.unshift(...older);
    bytes = Buffer.byteLength(text, "utf8");
  }

  return {
    record,
    entries: () => held,
    file: () => path.join(dirOf(), APP_LOG_FILENAME),
    installConsoleCapture,
    restoreFromDisk,
    flush: () => tail,
  };
}

/** One console argument, flattened to a single line. */
function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
