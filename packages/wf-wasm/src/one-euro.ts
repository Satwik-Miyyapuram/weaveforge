/**
 * The 1-Euro filter's smoothing factor (Rust `ink::one_euro`). The stateful
 * filters stay in TS on the pen path.
 */
import { oneEuroAlpha as rawOneEuroAlpha } from "../pkg/wf_wasm.js";

/**
 * The smoothing factor `1/(1 + tau/dt)` for a cutoff in **hertz** and a timestep
 * in **milliseconds**.
 */
export function oneEuroAlpha(cutoff: number, dtMs: number): number {
  return rawOneEuroAlpha(cutoff, dtMs);
}
