import { shouldPersistBody } from "../domain/save-policy.js";

/**
 * Writes a collaborative document's text back to its row: debounced while
 * typing, at once on `flush()`, and one last time on `close()`.
 *
 * Compaction deletes CRDT log rows once `flush()` resolves `true`, on the
 * strength of the body being the durable copy. So `true` means a save of the
 * newest text actually landed:
 *  - an edit reverted to the saved text is dropped, not saved later;
 *  - the saved text only moves once a save resolves, so a failed save stays
 *    dirty and is retried;
 *  - a save already in flight (the debounce's, or the one `close()` starts) is
 *    awaited instead of reported as done or fired a second time.
 */
export class BodySaver {
  private lastSaved: string;
  private ready = false;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<boolean> | null = null;

  constructor(
    private readonly deps: {
      save: (body: string) => Promise<void>;
      /** A save failed. Never thrown: callers fire saves without awaiting them. */
      onError: (err: unknown) => void;
      delayMs: number;
    },
    initialBody: string,
  ) {
    this.lastSaved = initialBody;
  }

  /** A new document is loading; nothing is saved until `seeded`. */
  begin(): void {
    this.ready = false;
  }

  /** The CRDT log is replayed and seeded; `body` is what the row holds. */
  seeded(body: string): void {
    this.lastSaved = body;
    this.ready = true;
  }

  schedule(body: string): void {
    this.clearTimer();
    if (!this.isEdit(body)) {
      this.pending = null;
      return;
    }
    this.pending = body;
    this.timer = setTimeout(() => void this.flush(), this.deps.delayMs);
  }

  /** Write the pending body now; resolves `true` once the newest text is stored. */
  flush(): Promise<boolean> {
    this.clearTimer();
    const body = this.pending;
    if (body === null) return this.inFlight ?? Promise.resolve(true);
    this.pending = null;
    return this.write(body);
  }

  /** The editor is going away: save `current` if it is an edit. */
  close(current: string): void {
    this.clearTimer();
    this.pending = null;
    if (this.isEdit(current)) void this.write(current);
  }

  private isEdit(body: string): boolean {
    return shouldPersistBody({ ready: this.ready, next: body, lastSaved: this.lastSaved });
  }

  private write(body: string): Promise<boolean> {
    const run = this.deps.save(body).then(
      () => {
        this.lastSaved = body;
        return true;
      },
      (err: unknown) => {
        // Keep it dirty for the next flush, unless a newer edit replaced it.
        this.pending ??= body;
        this.deps.onError(err);
        return false;
      },
    );
    this.inFlight = run;
    void run.finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    return run;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
