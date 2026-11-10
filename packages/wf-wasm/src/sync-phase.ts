/**
 * Sync phase rules (Rust `sync::sync_phase`), re-exported from index.ts.
 */
export {
  afterCycle,
  afterFailure,
  initialPhase,
  isCaughtUp,
} from "../pkg/wf_wasm.js";

/** The status the sync panel shows. */
export type SyncPhase = "idle" | "offline" | "error";

/** The phase and connectivity a finished or failed cycle leaves behind. */
export interface CyclePhase {
  phase: SyncPhase;
  isOnline: boolean;
}
