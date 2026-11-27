import { typedCore } from "@/lib/rust-core";

// --- sync-pacing ---
export interface Coalescer {
  /** Run after a quiet period, restarting the clock on each call. */
  request(): void;
  /** True while a read-back is being applied, so sync stands down. */
  suspended: boolean;
  /** Drop a pending request; a run already in flight still finishes. */
  cancel(): void;
}

export interface CoalescerOptions {
  run(): Promise<unknown>;
  debounceMs: number;
  onError?(error: unknown): void;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

/**
 * Debounce and coalesce sync requests.
 *
 * Several saves in a burst are one write-out, and a save that lands while a run
 * is in flight is re-run afterwards rather than folded into a snapshot taken
 * before it happened. Failures are reported, never thrown: the database is the
 * source of truth, so a lost sync write costs a stale file while failing the
 * save that triggered it would cost the user their edit.
 */
export function createCoalescer(options: CoalescerOptions): Coalescer {
  const setTimer = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as never));

  // Which run is due, when, and what is owed lives in Rust (`coalescerStep`). This file holds
  // only the timer handle and the run, and performs the actions each step returns.
  let state: CoalescerStateView = { suspended: false, timerArmed: false, inFlight: false, again: false };
  let timer: unknown = null;

  function dispatch(event: CoalescerEventView): void {
    const step = typedCore().coalescerStep(state, event) as CoalescerStepView;
    state = step.state;
    for (const action of step.actions) perform(action.type);
  }

  function perform(action: CoalescerActionView["type"]): void {
    if (action === "clearTimer") {
      if (timer !== null) clearTimer(timer);
      timer = null;
    } else if (action === "armTimer") {
      timer = setTimer(() => {
        timer = null;
        dispatch({ type: "timerFired" });
      }, options.debounceMs);
    } else {
      void runOnce();
    }
  }

  async function runOnce(): Promise<void> {
    try {
      await options.run();
    } catch (error) {
      options.onError?.(error);
    }
    dispatch({ type: "runSettled" });
  }

  return {
    get suspended() {
      return state.suspended;
    },
    set suspended(value: boolean) {
      dispatch({ type: "suspend", value });
    },
    request() {
      dispatch({ type: "request" });
    },
    cancel() {
      dispatch({ type: "cancel" });
    },
  };
}

interface CoalescerStateView {
  suspended: boolean;
  timerArmed: boolean;
  inFlight: boolean;
  again: boolean;
}

type CoalescerEventView =
  | { type: "request" | "cancel" | "timerFired" | "runSettled" }
  | { type: "suspend"; value: boolean };

interface CoalescerActionView {
  type: "clearTimer" | "armTimer" | "startRun";
}

interface CoalescerStepView {
  state: CoalescerStateView;
  actions: CoalescerActionView[];
}

// --- open-notes ---
/**
 * Notes open in an editor right now, by id.
 *
 * Editors save as they type, so a note open in one can hold text not yet saved; an outside edit to it waits for
 * review instead of landing under the cursor. Counted, since one note can be open in two places.
 */
const open = new Map<string, number>();
const closedListeners = new Set<(id: string) => void>();

/** Mark these notes open until the returned function is called. Calling it twice releases once. */
export function holdOpenNotes(ids: readonly string[]): () => void {
  const unique = [...new Set(ids)];
  for (const id of unique) open.set(id, (open.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const id of unique) {
      const count = (open.get(id) ?? 0) - 1;
      if (count > 0) open.set(id, count);
      else {
        open.delete(id);
        for (const listener of closedListeners) listener(id);
      }
    }
  };
}

/** Whether some editor has this note open. */
export function isNoteOpen(id: string): boolean {
  return open.has(id);
}

/** Hear when the last editor holding a note lets it go. */
export function onNoteClosed(listener: (id: string) => void): () => void {
  closedListeners.add(listener);
  return () => closedListeners.delete(listener);
}
