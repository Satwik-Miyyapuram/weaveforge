/**
 * One erase sweep (Rust `ink::eraser_sweep`): which pointer sweeps, and the
 * eraser cursor action each transition asks for. The cursor itself is a DOM
 * style, so the caller applies the action to the element it tracks.
 */
import { EraserSweepState as RawEraserSweepState } from "../pkg/wf_wasm.js";

/** What the caller does to the eraser cursor: nothing, show it, keep it, or restore the saved one. */
export type CursorActionName = "none" | "show" | "keep" | "restore";

/** The erase sweep's state (Rust `EraserSweepState`), down to up. */
export class EraserSweepState {
  private readonly raw = new RawEraserSweepState();

  /** Starts a sweep; `penEraser` is whether the pointer is the pen's eraser end. */
  begin(pointerId: number, toolErases: boolean, tipErases: boolean, penEraser: boolean): CursorActionName {
    return this.raw.begin(pointerId, toolErases, tipErases, penEraser) as CursorActionName;
  }

  /** Whether `pointerId` is the one sweeping. */
  owns(pointerId: number): boolean {
    return this.raw.owns(pointerId);
  }

  /** Ends the sweep `pointerId` owns. */
  end(pointerId: number): CursorActionName {
    return this.raw.end(pointerId) as CursorActionName;
  }

  /** A hover by `pointerId`. */
  hover(pointerId: number): CursorActionName {
    return this.raw.hover(pointerId) as CursorActionName;
  }

  /** The pointer `pointerId` left the surface. */
  leave(pointerId: number): CursorActionName {
    return this.raw.leave(pointerId) as CursorActionName;
  }

  /** A down by `pointerId` that did not erase. */
  release(pointerId: number): CursorActionName {
    return this.raw.release(pointerId) as CursorActionName;
  }
}
