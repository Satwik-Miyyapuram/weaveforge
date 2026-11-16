import { readyCore } from "@/lib/rust-core";
import { formatError } from "@/lib/format-error";

// --- toast-store ---
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
 *
 * The transitions (state, view, hidden keys, timer and commit effects) are Rust
 * (wf-core `app_lib::toast_store`). This module holds the timers, the Undo and
 * commit closures, the commit promises and the listeners.
 */

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

/** The reducer's state. Rust owns its shape, so it is passed back opaque. */
type ToastState = unknown;

type ToastAction =
  | { type: "show"; message: string; actionLabel: string; hasRun: boolean; now: number }
  | { type: "deferDelete"; message: string; keys: readonly string[]; now: number }
  | { type: "act"; id: number }
  | { type: "dismiss"; id: number }
  | { type: "undoLatest" }
  | { type: "pause"; id: number; reason: PauseReason; now: number }
  | { type: "resume"; id: number; reason: PauseReason; now: number }
  | { type: "windowHidden"; hidden: boolean; now: number }
  | { type: "flush" }
  | { type: "committing"; id: number; keys: readonly string[] }
  | { type: "committed"; id: number };

type ToastEffect =
  | { kind: "start"; id: number; ms: number }
  | { kind: "stop"; id: number }
  | { kind: "run"; id: number }
  | { kind: "commit"; id: number; keys: readonly string[] };

interface ToastReduction {
  state: ToastState;
  effects: readonly ToastEffect[];
  view: readonly Toast[];
  hidden: readonly string[];
  /** The toast a show or deferDelete created, or the one undoLatest undid. */
  id?: number;
  changed: boolean;
}

/** The closures a toast holds: its Undo or action, and a delete's commit. */
interface ToastClosures {
  run?: () => void;
  commit?: DeferredDelete["commit"];
  failure?: string;
}

const systemClock: ToastClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class ToastStore {
  private state: ToastState | undefined;
  private view: readonly Toast[] = [];
  private hidden: ReadonlySet<string> = new Set();
  private listeners = new Set<() => void>();
  private closures = new Map<number, ToastClosures>();
  private timers = new Map<number, unknown>();
  /** Nesting depth of dispatch. Closures are pruned only when the outermost dispatch ends. */
  private depth = 0;

  constructor(private readonly clock: ToastClock = systemClock) {}

  show(input: ToastInput): number {
    const closure = input.action ? { run: input.action.run } : undefined;
    return this.dispatch(
      { type: "show", message: input.message, actionLabel: input.action?.label ?? "", hasRun: input.action !== undefined, now: this.clock.now() },
      closure,
    ).id as number;
  }

  deferDelete(input: DeferredDelete): number {
    const closure = { run: input.restore ?? (() => {}), commit: input.commit, failure: input.failure ?? "Could not delete" };
    return this.dispatch({ type: "deferDelete", message: input.message, keys: input.keys, now: this.clock.now() }, closure).id as number;
  }

  /** Press the toast's button: Undo, or its own action. Never commits. */
  act(id: number): void {
    this.dispatch({ type: "act", id });
  }

  /** Close the toast (✕ or timeout). A pending delete commits now. */
  dismiss(id: number): void {
    this.dispatch({ type: "dismiss", id });
  }

  /** Ctrl+Z outside a text field. True when there was something to undo. */
  undoLatest(): boolean {
    return typeof this.dispatch({ type: "undoLatest" }).id === "number";
  }

  pause(id: number, reason: PauseReason): void {
    this.dispatch({ type: "pause", id, reason, now: this.clock.now() });
  }

  resume(id: number, reason: PauseReason): void {
    this.dispatch({ type: "resume", id, reason, now: this.clock.now() });
  }

  setWindowHidden(hidden: boolean): void {
    this.dispatch({ type: "windowHidden", hidden, now: this.clock.now() });
  }

  /** Commit every pending delete now: the app is quitting. */
  flush(): void {
    this.dispatch({ type: "flush" });
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

  /** Run one action through the Rust reducer, then perform the effects it returns. */
  private dispatch(action: ToastAction, closure?: ToastClosures): ToastReduction {
    const current = (this.state ??= readyCore().toastInitialState());
    const result = readyCore().toastReduce(current, action) as ToastReduction;
    this.state = result.state;
    if (result.changed) {
      this.view = result.view;
      this.hidden = new Set(result.hidden);
      for (const listener of this.listeners) listener();
    }
    if (closure && result.id !== undefined) this.closures.set(result.id, closure);
    this.depth++;
    try {
      for (const effect of result.effects) this.perform(effect);
    } finally {
      this.depth--;
    }
    if (this.depth === 0) this.pruneClosures();
    return result;
  }

  private perform(effect: ToastEffect): void {
    switch (effect.kind) {
      case "start":
        this.timers.set(
          effect.id,
          this.clock.setTimeout(() => {
            this.timers.delete(effect.id);
            this.dismiss(effect.id);
          }, effect.ms),
        );
        return;
      case "stop":
        this.clock.clearTimeout(this.timers.get(effect.id));
        this.timers.delete(effect.id);
        return;
      case "run":
        this.closures.get(effect.id)?.run?.();
        return;
      case "commit":
        this.commit(effect.id, effect.keys);
        return;
    }
  }

  private commit(id: number, keys: readonly string[]): void {
    const pending = this.closures.get(id);
    if (!pending?.commit) return;
    const fail = (error: unknown) => this.show({ message: `${pending.failure ?? "Could not delete"}: ${formatError(error)}` });
    let result: unknown;
    try {
      result = pending.commit();
    } catch (error) {
      fail(error);
      return;
    }
    if (!result || typeof (result as Promise<unknown>).then !== "function") return;
    this.dispatch({ type: "committing", id, keys });
    void (result as Promise<unknown>)
      .catch(fail)
      .finally(() => this.dispatch({ type: "committed", id }));
  }

  /** Drop the closures of toasts that have closed. */
  private pruneClosures(): void {
    const open = new Set(this.view.map((t) => t.id));
    for (const id of this.closures.keys()) if (!open.has(id)) this.closures.delete(id);
  }
}

/** The app's one store. Tests make their own with a fake clock. */
export const toasts = new ToastStore();

// --- copy-text ---
/** Copy to the clipboard and say so in a toast, or say why it failed (DA-64). */
export async function copyText(
  text: string,
  message = "Copied",
  write: (text: string) => Promise<void> = (t) => navigator.clipboard.writeText(t),
): Promise<void> {
  try {
    await write(text);
    toasts.show({ message });
  } catch (err) {
    toasts.show({ message: `Could not copy: ${formatError(err)}` });
  }
}
