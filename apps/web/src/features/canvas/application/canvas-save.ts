/**
 * The debounced save of a canvas body. Kept apart from the editor so it runs
 * without the wasm core or React Flow: the editor reads the text on screen and
 * passes it in.
 */

/** How long the canvas waits after the last change before it saves. */
export const SAVE_DELAY_MS = 600;

/** The longest wait between retries of a failed save. */
const RETRY_MAX_MS = 30_000;

/** How many bodies we remember writing, so their echoes coming back are ignored. */
const ECHO_MEMORY = 8;

export interface CanvasSaverOptions {
  /** Writes the body through the note's normal save path. */
  write: (text: string) => unknown;
  /** Receives a failed read or write, as thrown. */
  onError: (error: unknown) => void;
  /** Called when the latest write lands, so the editor can clear a save-failure banner. */
  onSaved?: () => void;
  /** The body the canvas was loaded from; its echo is not a change. */
  loaded?: string;
  delayMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  unschedule?: (handle: unknown) => void;
}

export class CanvasSaver {
  /** The latest text sent to a write (or loaded); saving the same text is a no-op. */
  private saved: string | null = null;
  /** The latest write of `saved` failed and has not been retried yet. */
  private failed = false;
  private failures = 0;
  private read: (() => string) | null = null;
  private timer: unknown = null;
  private halted = false;
  private readonly sent: string[];
  private readonly opts: CanvasSaverOptions;

  constructor(opts: CanvasSaverOptions) {
    this.opts = opts;
    this.sent = opts.loaded === undefined ? [] : [opts.loaded];
  }

  /** Whether a change waits for the debounce or a retry. */
  hasPending(): boolean {
    return this.timer !== null;
  }

  /** Whether `body` is one this saver wrote (or was loaded with), so its return is not a change. */
  isOwnEcho(body: string): boolean {
    return this.sent.includes(body);
  }

  /** Called on every change. The first call only records what was loaded, so opening a canvas never rewrites it. */
  touch(read: () => string): void {
    if (this.halted) return;
    if (this.saved === null) {
      this.flush(read);
      return;
    }
    this.read = read;
    this.cancel();
    const schedule = this.opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = schedule(() => this.flush(read), this.opts.delayMs ?? SAVE_DELAY_MS);
  }

  /** Writes a pending change now. Nothing is written while halted. */
  flush(read: () => string): void {
    this.cancel();
    if (this.halted) return;
    this.read = read;
    let text: string;
    try {
      text = read();
    } catch (err) {
      this.opts.onError(err);
      return;
    }
    if (this.saved === null) {
      this.saved = text;
      return;
    }
    if (text === this.saved && !this.failed) return;
    // A retry resends text already remembered; remembering it again would push older echoes out.
    const retry = text === this.saved;
    this.saved = text;
    this.failed = false;
    if (!retry) this.remember(text);
    this.send(text);
  }

  /** Drops a pending change and stops saving until `resume`: the canvas shows a body it must not overwrite. */
  halt(): void {
    this.cancel();
    this.halted = true;
  }

  resume(): void {
    this.halted = false;
  }

  /** A body was loaded from outside: it becomes the baseline and any pending change or retry is dropped. */
  markLoaded(body: string): void {
    this.cancel();
    this.saved = null;
    this.failed = false;
    this.failures = 0;
    this.remember(body);
  }

  private send(text: string): void {
    const landed = () => {
      // An older write landing while a newer one is unsaved must not clear the banner.
      if (this.saved !== text) return;
      this.failed = false;
      this.failures = 0;
      this.opts.onSaved?.();
    };
    const failed = (err: unknown) => {
      // A failure of the latest text keeps it pending and retries it with backoff; an older failure is only reported.
      // Only the first failure in a run is reported, so a long outage shows one banner, not one per retry.
      const quiet = this.failures > 0;
      if (this.saved === text) {
        this.failed = true;
        this.failures += 1;
        this.retryLater();
      }
      if (!quiet) this.opts.onError(err);
    };
    try {
      Promise.resolve(this.opts.write(text)).then(landed, failed);
    } catch (err) {
      failed(err);
    }
  }

  private retryLater(): void {
    if (this.read === null) return;
    const read = this.read;
    const base = this.opts.delayMs ?? SAVE_DELAY_MS;
    const ms = Math.min(RETRY_MAX_MS, base * 2 ** (this.failures - 1));
    this.cancel();
    const schedule = this.opts.schedule ?? ((fn, wait) => setTimeout(fn, wait));
    this.timer = schedule(() => this.flush(read), ms);
  }

  private cancel(): void {
    if (this.timer === null) return;
    const unschedule = this.opts.unschedule ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    unschedule(this.timer);
    this.timer = null;
  }

  private remember(text: string): void {
    this.sent.push(text);
    if (this.sent.length > ECHO_MEMORY) this.sent.shift();
  }
}
