/**
 * The debounced save of a canvas body. Kept apart from the editor so it runs
 * without the wasm core or React Flow: the editor reads the text on screen and
 * passes it in.
 */

/** How long the canvas waits after the last change before it saves. */
export const SAVE_DELAY_MS = 600;

/** How many bodies we remember writing, so their echoes coming back are ignored. */
const ECHO_MEMORY = 8;

export interface CanvasSaverOptions {
  /** Writes the body through the note's normal save path. */
  write: (text: string) => unknown;
  /** Receives a failed read or write, as thrown. */
  onError: (error: unknown) => void;
  /** The body the canvas was loaded from; its echo is not a change. */
  loaded?: string;
  delayMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  unschedule?: (handle: unknown) => void;
}

export class CanvasSaver {
  /** The text on screen when it was last loaded or saved; saving the same text is a no-op. */
  private saved: string | null = null;
  private timer: unknown = null;
  private halted = false;
  private readonly sent: string[];
  private readonly opts: CanvasSaverOptions;

  constructor(opts: CanvasSaverOptions) {
    this.opts = opts;
    this.sent = opts.loaded === undefined ? [] : [opts.loaded];
  }

  /** Whether a change waits for the debounce. */
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
    this.cancel();
    const schedule = this.opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = schedule(() => this.flush(read), this.opts.delayMs ?? SAVE_DELAY_MS);
  }

  /** Writes a pending change now. Nothing is written while halted. */
  flush(read: () => string): void {
    this.cancel();
    if (this.halted) return;
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
    if (text === this.saved) return;
    this.saved = text;
    this.remember(text);
    try {
      Promise.resolve(this.opts.write(text)).catch(this.opts.onError);
    } catch (err) {
      this.opts.onError(err);
    }
  }

  /** Drops a pending change and stops saving until `resume`: the canvas shows a body it must not overwrite. */
  halt(): void {
    this.cancel();
    this.halted = true;
  }

  resume(): void {
    this.halted = false;
  }

  /** A body was loaded from outside: it becomes the baseline and any pending change is dropped. */
  markLoaded(body: string): void {
    this.cancel();
    this.saved = null;
    this.remember(body);
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
