/**
 * Toasts, and the delete-then-undo rule (design D10, D-07).
 *
 * A delete hides the item at once and shows "‹Item› deleted · Undo". The real
 * delete runs when the toast closes: after 8 s, on ✕, when a fourth toast
 * pushes it out, or when the app quits. Undo therefore never re-creates
 * anything, and sync sees one delete. If the app crashes first, the item comes
 * back, which is the safe side.
 *
 * The timer pauses while the pointer is over a toast, while it has focus, and
 * while the window is hidden, so a toast never times out unread.
 */

export const TOAST_MS = 8000;
export const MAX_TOASTS = 3;

export interface ToastClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface Toast {
  readonly id: number;
  readonly message: string;
  /** The one button on the toast ("Undo", "Open"), if any. */
  readonly actionLabel?: string;
  readonly undoable: boolean;
}

export interface ToastInput {
  message: string;
  action?: { label: string; run: () => void };
}

export interface DeferredDelete {
  /** Keys the screens hide while the toast shows (`useHiddenKeys`). */
  keys: readonly string[];
  /** "Paper deleted", "3 papers deleted". */
  message: string;
  /** The real delete. Runs once, when the toast closes. */
  commit: () => void | Promise<unknown>;
  /** Anything beyond un-hiding the keys that Undo must put back. */
  restore?: () => void;
  /** Start of the toast shown when the commit fails. Default "Could not delete". */
  failure?: string;
}

type PauseReason = "hover" | "focus";

interface Entry {
  toast: Toast;
  run?: () => void;
  commit?: DeferredDelete["commit"];
  failure: string;
  keys: readonly string[];
  remaining: number;
  startedAt: number;
  timer: unknown;
  pauses: Set<PauseReason>;
}

const systemClock: ToastClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class ToastStore {
  private entries: Entry[] = [];
  private nextId = 1;
  private windowHidden = false;
  private listeners = new Set<() => void>();
  private view: readonly Toast[] = [];
  private hidden: ReadonlySet<string> = new Set();
  /** Keys whose delete is running: still hidden, so the row does not flicker back. */
  private committing = new Map<number, readonly string[]>();

  constructor(private readonly clock: ToastClock = systemClock) {}

  show(input: ToastInput): number {
    return this.add({ message: input.message, actionLabel: input.action?.label, undoable: false }, input.action?.run);
  }

  deferDelete(input: DeferredDelete): number {
    const id = this.add({ message: input.message, actionLabel: "Undo", undoable: true }, input.restore ?? (() => {}), input);
    return id;
  }

  /** Press the toast's button: Undo, or its own action. Never commits. */
  act(id: number): void {
    const entry = this.take(id);
    if (!entry) return;
    entry.run?.();
    this.changed();
  }

  /** Close the toast (✕ or timeout). A pending delete commits now. */
  dismiss(id: number): void {
    const entry = this.take(id);
    if (!entry) return;
    this.changed();
    this.commit(entry);
  }

  /** Ctrl+Z outside a text field. True when there was something to undo. */
  undoLatest(): boolean {
    const latest = [...this.entries].reverse().find((e) => e.toast.undoable);
    if (!latest) return false;
    this.act(latest.toast.id);
    return true;
  }

  pause(id: number, reason: PauseReason): void {
    const entry = this.entries.find((e) => e.toast.id === id);
    if (!entry) return;
    entry.pauses.add(reason);
    this.syncTimer(entry);
  }

  resume(id: number, reason: PauseReason): void {
    const entry = this.entries.find((e) => e.toast.id === id);
    if (!entry) return;
    entry.pauses.delete(reason);
    this.syncTimer(entry);
  }

  setWindowHidden(hidden: boolean): void {
    this.windowHidden = hidden;
    for (const entry of this.entries) this.syncTimer(entry);
  }

  /** Commit every pending delete now: the app is quitting. */
  flush(): void {
    const all = this.entries;
    this.entries = [];
    for (const entry of all) this.clock.clearTimeout(entry.timer);
    this.changed();
    for (const entry of all) this.commit(entry);
  }

  snapshot(): readonly Toast[] {
    return this.view;
  }

  hiddenKeys(): ReadonlySet<string> {
    return this.hidden;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private add(toast: Omit<Toast, "id">, run?: () => void, del?: DeferredDelete): number {
    const id = this.nextId++;
    const entry: Entry = {
      toast: { id, ...toast },
      run,
      commit: del?.commit,
      failure: del?.failure ?? "Could not delete",
      keys: del?.keys ?? [],
      remaining: TOAST_MS,
      startedAt: this.clock.now(),
      timer: undefined,
      pauses: new Set(),
    };
    this.entries.push(entry);
    const overflow = this.entries.length > MAX_TOASTS ? this.entries.splice(0, this.entries.length - MAX_TOASTS) : [];
    for (const old of overflow) this.clock.clearTimeout(old.timer);
    this.syncTimer(entry);
    this.changed();
    for (const old of overflow) this.commit(old);
    return id;
  }

  private take(id: number): Entry | undefined {
    const i = this.entries.findIndex((e) => e.toast.id === id);
    if (i < 0) return undefined;
    const [entry] = this.entries.splice(i, 1);
    this.clock.clearTimeout(entry!.timer);
    return entry;
  }

  private commit(entry: Entry): void {
    if (!entry.commit) return;
    const id = entry.toast.id;
    const fail = (error: unknown) =>
      this.show({ message: `${entry.failure}: ${error instanceof Error ? error.message : String(error)}` });
    let result: unknown;
    try {
      result = entry.commit();
    } catch (error) {
      fail(error);
      return;
    }
    if (!result || typeof (result as Promise<unknown>).then !== "function") return;
    this.committing.set(id, entry.keys);
    this.changed();
    void (result as Promise<unknown>).catch(fail).finally(() => {
      this.committing.delete(id);
      this.changed();
    });
  }

  /** Run the timer only while nothing pauses it, keeping the time left. */
  private syncTimer(entry: Entry): void {
    const paused = this.windowHidden || entry.pauses.size > 0;
    if (entry.timer !== undefined) {
      this.clock.clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.remaining -= this.clock.now() - entry.startedAt;
    }
    if (paused) return;
    entry.startedAt = this.clock.now();
    entry.timer = this.clock.setTimeout(() => {
      entry.timer = undefined;
      this.dismiss(entry.toast.id);
    }, Math.max(0, entry.remaining));
  }

  private changed(): void {
    this.view = this.entries.map((e) => e.toast);
    this.hidden = new Set([...this.entries.flatMap((e) => e.keys), ...[...this.committing.values()].flat()]);
    for (const listener of this.listeners) listener();
  }
}

/** The app's one store. Tests make their own with a fake clock. */
export const toasts = new ToastStore();
