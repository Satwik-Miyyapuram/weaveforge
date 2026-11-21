/**
 * The debounced save of a canvas body. Kept apart from the editor so it runs
 * without the wasm core: the editor reads the text on screen and
 * passes it in.
 */

/** How long the canvas waits after the last change before it saves. */
export const SAVE_DELAY_MS = 600;

/** The longest wait between retries of a failed save. */
const RETRY_MAX_MS = 30_000;

/** How many bodies we remember writing, so their echoes coming back are ignored. */
const ECHO_MEMORY = 8;

export interface CanvasSaverOptions {
  /**
   * Writes the body through the note's normal save path. `base` is the body
   * this text was built on (undefined when unknown), so the store can merge
   * or keep a conflict copy when it moved on. May resolve the body it stored.
   */
  write: (text: string, base: string | undefined) => unknown;
  /** Receives a failed read or write, as thrown. */
  onError: (error: unknown) => void;
  /** Called when the latest write lands, so the editor can clear a save-failure banner. */
  onSaved?: () => void;
  /** The store kept a different body than we sent (it merged theirs in): show it. */
  onStored?: (body: string) => void;
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
  /** Bumped by `dispose`: a write sent before it settles without retries or callbacks. */
  private epoch = 0;
  /** The body the store held when our current text was built; sent as the write's base. */
  private base: string | undefined;
  /** The text of the write in flight; a newer change waits for it, so it can name the body it stored. */
  private inflight: string | null = null;
  /** A change made just before `dispose`, still waiting for the write in flight. */
  private orphan: string | null = null;
  /** Their latest body, received while our write was in flight; shown if the store kept it over ours. */
  private deferred: string | null = null;
  private readonly sent: string[];
  private readonly opts: CanvasSaverOptions;

  constructor(opts: CanvasSaverOptions) {
    this.opts = opts;
    this.sent = opts.loaded === undefined ? [] : [opts.loaded];
    this.base = opts.loaded;
  }

  /** Whether a change waits for the debounce or a retry. */
  hasPending(): boolean {
    return this.timer !== null;
  }

  /** Whether `body` is one this saver wrote (or was loaded with), so its return is not a change. */
  isOwnEcho(body: string): boolean {
    const at = this.sent.indexOf(body);
    if (at < 0) return false;
    // Seen once: the same body arriving again is someone reverting to it.
    this.sent.splice(at, 1);
    return true;
  }

  /**
   * A body arrived from the store; true when it is someone else's, to show.
   * While a change of ours is unsaved, theirs is not shown: our write names
   * the body it was built on, the store merges theirs in (or keeps a conflict
   * copy), and `onStored` shows the result.
   */
  receive(body: string): boolean {
    if (this.isOwnEcho(body)) {
      // Our write's echo after theirs: theirs was stored first, so ours answers it.
      if (body === this.inflight) this.deferred = null;
      return false;
    }
    if (this.timer !== null || this.inflight !== null || this.failed) {
      // Only a body seen during the flight can be newer than what the write stores.
      if (this.inflight !== null) this.deferred = body;
      return false;
    }
    this.markLoaded(body);
    return true;
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
    // One write at a time: the next one goes when this lands, against what it stored.
    if (this.inflight === null) this.send(text);
  }

  /** Drops a pending change and stops saving until `resume`: the canvas shows a body it must not overwrite. */
  halt(): void {
    this.cancel();
    this.halted = true;
  }

  resume(): void {
    this.halted = false;
  }

  /** The editor is gone: a waiting save or retry is dropped, and writes already sent settle without callbacks. */
  dispose(): void {
    this.cancel();
    this.epoch += 1;
    // The last change, waiting for the write in flight, still gets its one attempt.
    this.orphan = this.inflight !== null && this.saved !== this.inflight ? this.saved : null;
    this.inflight = null;
    this.deferred = null;
  }

  /** A body was loaded from outside: it becomes the baseline and any pending change or retry is dropped. */
  markLoaded(body: string): void {
    this.cancel();
    this.base = body;
    this.saved = null;
    this.deferred = null;
    this.failed = false;
    this.failures = 0;
  }

  private send(text: string): void {
    const epoch = this.epoch;
    this.inflight = text;
    // A body seen before this write was sent is older than it: the store merges it or keeps a copy.
    this.deferred = null;
    const landed = (result: unknown) => {
      const stored = typeof result === "string" ? result : text;
      if (epoch !== this.epoch) {
        this.sendOrphan(text);
        return;
      }
      this.inflight = null;
      const newer = this.saved !== text;
      // A change made since this write was sent is built on `text`; naming it
      // as the base lets the store merge it with whatever it stored.
      this.base = newer || this.timer !== null ? text : stored;
      if (newer) {
        // A halt since this write was sent protects the body on screen: the
        // queued change is dropped like any other pending save (P2-153).
        if (this.saved !== null && !this.halted) this.send(this.saved);
        return;
      }
      this.failed = false;
      this.failures = 0;
      this.opts.onSaved?.();
      if (this.timer !== null) return;
      if (stored !== text) {
        // The store merged theirs into ours: show that, and know its echo.
        this.markLoaded(stored);
        this.remember(stored);
        this.opts.onStored?.(stored);
      } else if (this.deferred !== null && this.deferred !== text) {
        // Theirs arrived during the flight and was stored after ours: show it.
        const theirs = this.deferred;
        this.markLoaded(theirs);
        this.opts.onStored?.(theirs);
      } else this.deferred = null;
    };
    const failed = (err: unknown) => {
      if (epoch !== this.epoch) {
        this.sendOrphan(this.base);
        return;
      }
      this.inflight = null;
      // The latest text stays pending and is retried with backoff, against the same base.
      // Only the first failure in a run is reported, so a long outage shows one banner, not one per retry.
      const quiet = this.failures > 0;
      this.failed = true;
      this.failures += 1;
      this.retryLater();
      if (!quiet) this.opts.onError(err);
    };
    let result: unknown;
    try {
      result = this.opts.write(text, this.base);
    } catch (err) {
      failed(err);
      return;
    }
    if (isThenable(result)) result.then(landed, failed);
    else landed(result);
  }

  /** After `dispose`: the change that waited for the write in flight is sent once, with no callbacks. */
  private sendOrphan(base: string | undefined): void {
    const text = this.orphan;
    this.orphan = null;
    if (text === null) return;
    try {
      void Promise.resolve(this.opts.write(text, base)).catch(() => undefined);
    } catch {
      // Nothing is left to report it to.
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

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}
